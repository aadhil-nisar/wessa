/**
 * Wessa backend (Firebase Cloud Functions, 2nd gen, Node 20).
 *
 * checkRisk        runs every hour: pulls the forecast for all 25 districts,
 *                  scores them with risk.js (the same file the website uses),
 *                  stores the result in Firestore and messages Telegram
 *                  subscribers when a district's level goes up.
 * telegramWebhook  receives Telegram bot updates: /subscribe, /unsubscribe,
 *                  /list, /status, /stop.
 *
 * Firestore layout
 *   districts/{id}           latest assessment for one district
 *   runs/{yyyy-mm-ddThh}     compact record of every hourly run
 *   subscribers/{chatId}     { districts: ["kandy", ...], lang: "en", createdAt }
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const Risk = require("./risk.js");
const DISTRICTS = require("./districts.json");

admin.initializeApp();
const db = admin.firestore();

const TELEGRAM_TOKEN = defineSecret("TELEGRAM_TOKEN");
const TELEGRAM_SECRET = defineSecret("TELEGRAM_SECRET");
const SITE_URL = process.env.SITE_URL || "";

/* ---------- Data ---------- */
async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}

async function fetchForecast() {
  const lat = DISTRICTS.map((d) => d.lat).join(",");
  const lon = DISTRICTS.map((d) => d.lon).join(",");
  const [wx, flood] = await Promise.all([
    getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,precipitation_probability_max&past_days=3&forecast_days=7&timezone=Asia%2FColombo`),
    getJson(`https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge&past_days=3&forecast_days=7`).catch((e) => {
      logger.warn("Flood API failed, scoring on rain only", e.message);
      return null;
    }),
  ]);
  return DISTRICTS.map((d, i) => ({
    district: d,
    time: wx[i].daily.time,
    rain: wx[i].daily.precipitation_sum,
    prob: wx[i].daily.precipitation_probability_max,
    flow: flood ? flood[i].daily.river_discharge : [],
  }));
}

/* ---------- Telegram ---------- */
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN.value()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) logger.warn("Telegram error", method, json.description);
  return json;
}
const send = (chatId, text) => tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true });

function findDistrict(text) {
  const q = (text || "").trim().toLowerCase();
  if (!q) return null;
  return DISTRICTS.find((d) => d.id === q.replace(/\s+/g, "-") || d.en.toLowerCase() === q || d.si === text.trim() || d.ta === text.trim())
    || DISTRICTS.find((d) => d.en.toLowerCase().startsWith(q));
}

function alertText(d, a, time) {
  const lines = [
    `<b>${d.en}: ${a.name}</b> (${d.si} / ${d.ta})`,
    ...a.reasons.map((r) => `• ${r.charAt(0).toUpperCase()}${r.slice(1)}`),
    `Wettest day ahead: ${a.peak} mm on ${time[a.peakIdx]}. Last 3 days: ${a.past3} mm.`,
    "",
    "Not an official warning. Follow DMC (117), the Met Department and NBRO.",
  ];
  if (SITE_URL) lines.push(`${SITE_URL}#${d.id}`);
  return lines.join("\n");
}

/* ---------- Hourly check ---------- */
exports.checkRisk = onSchedule(
  { schedule: "every 60 minutes", timeZone: "Asia/Colombo", region: "asia-south1", secrets: [TELEGRAM_TOKEN], retryCount: 1 },
  async () => {
    const rows = await fetchForecast();
    const prevSnap = await db.collection("districts").get();
    const prev = Object.fromEntries(prevSnap.docs.map((doc) => [doc.id, doc.data()]));
    const batch = db.batch();
    const raised = [];
    const now = admin.firestore.Timestamp.now();

    for (const row of rows) {
      const d = row.district;
      const a = Risk.assess({ rain: row.rain, flow: row.flow, landslideProne: d.ls });
      const before = prev[d.id] ? prev[d.id].level : 0;
      if (a.level > before && a.level >= 1) raised.push({ d, a, time: row.time });
      batch.set(db.collection("districts").doc(d.id), {
        name: d.en, level: a.level, levelName: a.name, peak: a.peak, peakDay: row.time[a.peakIdx],
        past3: a.past3, week: a.week, rise: a.rise, reasons: a.reasons, rain: row.rain, time: row.time, updatedAt: now,
      });
    }
    const runId = new Date().toISOString().slice(0, 13);
    batch.set(db.collection("runs").doc(runId), {
      at: now,
      levels: Object.fromEntries(rows.map((r, i) => [r.district.id, Risk.assess({ rain: r.rain, flow: r.flow, landslideProne: r.district.ls }).level])),
    });
    await batch.commit();
    logger.info(`Scored ${rows.length} districts, ${raised.length} raised`);

    for (const { d, a, time } of raised) {
      const subs = await db.collection("subscribers").where("districts", "array-contains", d.id).get();
      for (const s of subs.docs) await send(s.id, alertText(d, a, time));
    }
  }
);

/* ---------- Bot commands ---------- */
const HELP = [
  "<b>Wessa</b> sends a message when rain or river levels push a Sri Lankan district up a risk level.",
  "",
  "/subscribe Kandy — get alerts for a district",
  "/unsubscribe Kandy — stop alerts for one district",
  "/list — districts you follow",
  "/status Kandy — current level and rain outlook",
  "/stop — remove all your subscriptions",
  "",
  "District names work in English, Sinhala or Tamil.",
].join("\n");

exports.telegramWebhook = onRequest(
  { region: "asia-south1", secrets: [TELEGRAM_TOKEN, TELEGRAM_SECRET] },
  async (req, res) => {
    if (req.get("X-Telegram-Bot-Api-Secret-Token") !== TELEGRAM_SECRET.value()) return res.status(401).send("no");
    const msg = req.body && req.body.message;
    if (!msg || !msg.text) return res.send("ok");
    const chatId = String(msg.chat.id);
    const [cmdRaw, ...rest] = msg.text.trim().split(/\s+/);
    const cmd = cmdRaw.split("@")[0].toLowerCase();
    const arg = rest.join(" ");
    const ref = db.collection("subscribers").doc(chatId);

    try {
      if (cmd === "/start" || cmd === "/help") {
        await send(chatId, HELP);
      } else if (cmd === "/subscribe") {
        const d = findDistrict(arg);
        if (!d) await send(chatId, "Which district? For example: /subscribe Ratnapura");
        else {
          await ref.set({ districts: admin.firestore.FieldValue.arrayUnion(d.id), createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          const cur = await db.collection("districts").doc(d.id).get();
          const lvl = cur.exists ? ` It is at <b>${cur.data().levelName}</b> right now.` : "";
          await send(chatId, `Following ${d.en}. You'll get a message when its level goes up.${lvl}`);
        }
      } else if (cmd === "/unsubscribe") {
        const d = findDistrict(arg);
        if (!d) await send(chatId, "Which district? For example: /unsubscribe Ratnapura");
        else {
          await ref.set({ districts: admin.firestore.FieldValue.arrayRemove(d.id) }, { merge: true });
          await send(chatId, `Stopped alerts for ${d.en}.`);
        }
      } else if (cmd === "/list") {
        const doc = await ref.get();
        const ids = doc.exists ? doc.data().districts || [] : [];
        await send(chatId, ids.length ? "You follow: " + ids.map((id) => DISTRICTS.find((d) => d.id === id).en).join(", ") : "You don't follow any district yet. Try /subscribe Kandy");
      } else if (cmd === "/status") {
        const d = findDistrict(arg);
        if (!d) await send(chatId, "Which district? For example: /status Galle");
        else {
          const cur = await db.collection("districts").doc(d.id).get();
          await send(chatId, cur.exists ? alertText(d, { ...cur.data(), name: cur.data().levelName, peakIdx: cur.data().time.indexOf(cur.data().peakDay) }, cur.data().time) : "No data yet. The first check runs within the hour.");
        }
      } else if (cmd === "/stop") {
        await ref.delete();
        await send(chatId, "All alerts removed. Send /subscribe to start again.");
      } else {
        await send(chatId, HELP);
      }
    } catch (e) {
      logger.error(e);
    }
    res.send("ok");
  }
);
