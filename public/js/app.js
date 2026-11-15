(function () {
  "use strict";

  var GEO = window.WESSA_DISTRICTS;
  var SNAP = window.WESSA_SNAPSHOT;
  var Risk = window.WessaRisk;
  var D = GEO.districts;
  var TODAY = Risk.TODAY;
  var LVL = ["var(--l0)", "var(--l1)", "var(--l2)", "var(--l3)"];
  var RAIN_STEPS = [
    { max: 10, c: "var(--r0)", label: "under 10" },
    { max: 25, c: "var(--r1)", label: "10–25" },
    { max: 50, c: "var(--r2)", label: "25–50" },
    { max: 100, c: "var(--r3)", label: "50–100" },
    { max: 200, c: "var(--r4)", label: "100–200" },
    { max: Infinity, c: "var(--r5)", label: "200+ mm" }
  ];
  var DAY_STEPS = [
    { max: 1, c: "var(--r0)", label: "dry" },
    { max: 10, c: "var(--r1)", label: "1–10" },
    { max: 25, c: "var(--r2)", label: "10–25" },
    { max: 50, c: "var(--r3)", label: "25–50" },
    { max: 100, c: "var(--r4)", label: "50–100" },
    { max: Infinity, c: "var(--r5)", label: "100+ mm" }
  ];
  var CENTRE = { lat: 7.87, lon: 80.77 };
  function stepColor(steps, v) { for (var k = 0; k < steps.length; k++) if (v < steps[k].max) return steps[k].c; }
  function isoToday() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" }); }
  function addDays(iso, n) { var t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

  var state = {
    view: "now", mode: "risk", day: null, lang: "en", sel: null, loading: true,
    sets: {}, source: null
  };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function nameOf(d, lang) { return d[lang || state.lang] || d.en; }
  function langAttr(lang) { return lang === "en" ? "" : ' lang="' + lang + '"'; }
  function fmtDay(iso, withWeekday) {
    var dt = new Date(iso + "T00:00:00");
    var m = dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return withWeekday ? dt.toLocaleDateString("en-GB", { weekday: "short" }) + " " + m : m;
  }
  function fmtStamp(iso) {
    var dt = new Date(iso);
    return dt.toLocaleString("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function mm(v) { return v >= 100 ? Math.round(v) : (Math.round(v * 10) / 10); }
  function km(a, b) {
    var R = 6371, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }

  /* ---------- Data ---------- */
  function withTimeout(url, ms) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function loadLive() {
    var lat = D.map(function (d) { return d.lat; }).join(",");
    var lon = D.map(function (d) { return d.lon; }).join(",");
    var since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    var wx = withTimeout("https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
      "&daily=precipitation_sum,precipitation_probability_max&past_days=3&forecast_days=7&timezone=Asia%2FColombo", 9000);
    var fl = withTimeout("https://flood-api.open-meteo.com/v1/flood?latitude=" + lat + "&longitude=" + lon +
      "&daily=river_discharge&past_days=3&forecast_days=7", 9000).catch(function () { return null; });
    var eq = withTimeout("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=" + since +
      "&minlatitude=0&maxlatitude=16&minlongitude=72&maxlongitude=92&minmagnitude=4", 9000).catch(function () { return null; });
    var gd = withTimeout("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC;FL;EQ&country=Sri%20Lanka", 9000).catch(function () { return null; });

    return Promise.all([wx, fl, eq, gd]).then(function (r) {
      var w = r[0], f = r[1], q = r[2], g = r[3];
      if (!Array.isArray(w) || w.length !== D.length) throw new Error("Unexpected forecast response");
      return {
        live: true,
        fetchedAt: new Date().toISOString(),
        time: w[0].daily.time,
        rain: w.map(function (x) { return x.daily.precipitation_sum; }),
        prob: w.map(function (x) { return x.daily.precipitation_probability_max; }),
        flow: Array.isArray(f) ? f.map(function (x) { return x.daily.river_discharge; }) : null,
        quakes: q ? q.features.map(function (ft) {
          return { mag: ft.properties.mag, place: ft.properties.place, time: ft.properties.time, url: ft.properties.url, lon: ft.geometry.coordinates[0], lat: ft.geometry.coordinates[1] };
        }) : null,
        events: g && g.features ? g.features.map(function (ft) {
          var p = ft.properties;
          return { type: p.eventtype, name: p.name, level: p.alertlevel, from: p.fromdate, to: p.todate, current: p.iscurrent === "true", url: p.url && p.url.report };
        }) : null
      };
    });
  }

  function assessSet(set) {
    return D.map(function (d, i) {
      var a = Risk.assess({ rain: set.rain[i], flow: set.flow ? set.flow[i] : [], landslideProne: d.ls });
      a.i = i; a.d = d;
      a.prob = set.prob ? Math.max.apply(null, set.prob[i].slice(TODAY, TODAY + 3)) : null;
      return a;
    });
  }
  function ranked(list) {
    return list.slice().sort(function (a, b) { return b.level - a.level || b.peak - a.peak || a.d.en.localeCompare(b.d.en); });
  }

  /* ---------- Map ---------- */
  var NS = "http://www.w3.org/2000/svg";
  var paths = {}, label;
  function buildMap() {
    var svg = $("map");
    svg.setAttribute("viewBox", "0 0 " + GEO.w + " " + GEO.h);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    D.forEach(function (d) {
      var p = document.createElementNS(NS, "path");
      p.setAttribute("d", d.d);
      p.setAttribute("class", "d");
      p.setAttribute("tabindex", "0");
      p.setAttribute("role", "button");
      p.dataset.id = d.id;
      p.addEventListener("click", function () { select(d.id, true); });
      p.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(d.id, true); } });
      p.addEventListener("mousemove", function (e) { showTip(d, e); });
      p.addEventListener("mouseleave", hideTip);
      svg.appendChild(p);
      paths[d.id] = p;
    });
    label = document.createElementNS(NS, "text");
    label.setAttribute("class", "lbl");
    label.setAttribute("text-anchor", "middle");
    svg.appendChild(label);
  }

  function fillFor(a) {
    if (state.mode === "risk") return LVL[a.level];
    if (state.mode === "day") return stepColor(DAY_STEPS, dayRain(a.i));
    return stepColor(RAIN_STEPS, sumAhead(a.i));
  }
  function dayRain(i) { var v = current().rain[i][state.day]; return v == null ? 0 : v; }
  function sumAhead(i) {
    var r = current().rain[i].slice(TODAY, TODAY + 3);
    return r.reduce(function (s, v) { return s + (v || 0); }, 0);
  }

  function paintMap() {
    var list = current().assess;
    list.forEach(function (a) {
      var p = paths[a.d.id];
      p.style.fill = fillFor(a);
      p.setAttribute("aria-label", a.d.en + ": " + a.name + ", wettest day ahead " + mm(a.peak) + " millimetres");
      p.classList.toggle("sel", a.d.id === state.sel);
    });
    var selD = D.find(function (d) { return d.id === state.sel; });
    if (selD) {
      paths[selD.id].parentNode.appendChild(paths[selD.id]);
      paths[selD.id].parentNode.appendChild(label);
      label.textContent = nameOf(selD);
      if (state.lang !== "en") label.setAttribute("lang", state.lang); else label.removeAttribute("lang");
      label.setAttribute("x", selD.lx);
      label.setAttribute("y", selD.ly + 8);
    }
    var lg = $("legend");
    if (state.mode === "day") {
      lg.innerHTML = '<span>' + fmtDay(current().time[state.day], true) + ':</span>' + DAY_STEPS.map(function (s) { return '<span><i style="background:' + s.c + '"></i>' + s.label + "</span>"; }).join("");
    } else if (state.mode === "risk") {
      lg.innerHTML = Risk.LEVELS.map(function (l, i) { return '<span><i style="background:' + LVL[i] + '"></i>' + l.name + "</span>"; }).join("");
    } else {
      lg.innerHTML = RAIN_STEPS.map(function (s) { return '<span><i style="background:' + s.c + '"></i>' + s.label + "</span>"; }).join("");
    }
  }

  function showTip(d, e) {
    if (window.matchMedia("(hover: none)").matches) return;
    var a = current().assess[D.indexOf(d)];
    var wrap = $("mapWrap").getBoundingClientRect();
    var tip = $("tip");
    tip.innerHTML = "<b" + langAttr(state.lang) + ">" + esc(nameOf(d)) + "</b>" + (state.mode === "day"
      ? fmtDay(current().time[state.day], true) + ": " + mm(dayRain(a.i)) + " mm"
      : a.name + " · wettest day " + mm(a.peak) + " mm<br>Next 3 days: " + mm(sumAhead(a.i)) + " mm");
    tip.style.left = (e.clientX - wrap.left) + "px";
    tip.style.top = (e.clientY - wrap.top) + "px";
    tip.hidden = false;
  }
  function hideTip() { $("tip").hidden = true; }

  /* ---------- Panels ---------- */
  function current() { return state.sets[state.view]; }

  function renderStatus() {
    var s = $("status"), set = current();
    if (state.view === "ditwah") {
      s.innerHTML = '<span class="dot saved"></span>Replay of 24 Nov to 3 Dec 2025, viewed from 27 Nov';
    } else if (state.view === "date") {
      s.innerHTML = '<span class="dot live"></span>Looking at ' + esc(fmtDay(set.time[TODAY], true) + " " + set.time[TODAY].slice(0, 4)) + ", with 3 days before and the days after";
    } else if (state.loading) {
      s.innerHTML = '<span class="dot"></span>Checking for live data…';
    } else if (set.live) {
      s.innerHTML = '<span class="dot live"></span>Live data, updated ' + esc(fmtStamp(set.fetchedAt));
    } else {
      s.innerHTML = '<span class="dot saved"></span>Saved data from ' + esc(fmtStamp(set.fetchedAt)) + ". Live services unreachable here.";
    }
  }

  function renderLede() {
    var set = current(), list = ranked(set.assess);
    var counts = [0, 0, 0, 0];
    set.assess.forEach(function (a) { counts[a.level]++; });
    var parts = [];
    for (var l = 3; l >= 1; l--) if (counts[l]) parts.push(counts[l] + " " + Risk.LEVELS[l].name);
    var title;
    if (!parts.length) title = state.view === "now" ? "No district is above normal for the next three days." : "No district was above normal in the three days from " + fmtDay(set.time[TODAY], true) + ".";
    else {
      var joined = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0];
      var n = counts[1] + counts[2] + counts[3];
      title = joined + (n === 1 ? " district" : " districts") + (state.view === "now" ? " in the next three days." : " in the three days from " + fmtDay(set.time[TODAY], true) + ".");
    }
    var top = list.slice().sort(function (a, b) { return b.peak - a.peak; })[0];
    var soaked = set.assess.slice().sort(function (a, b) { return b.past3 - a.past3; })[0];
    var line = "Heaviest single day ahead: " + mm(top.peak) + " mm in <span" + langAttr(state.lang) + ">" + esc(nameOf(top.d)) + "</span> on " + fmtDay(set.time[top.peakIdx], true) + ". " +
      "Most rain in the last three days: " + mm(soaked.past3) + " mm in <span" + langAttr(state.lang) + ">" + esc(nameOf(soaked.d)) + "</span>.";

    var units = list.map(function (a) {
      return '<button type="button" class="' + (a.d.id === state.sel ? "sel" : "") + '" data-id="' + a.d.id + '" style="background:' + LVL[a.level] +
        '" title="' + esc(a.d.en + ": " + a.name) + '" aria-label="' + esc(a.d.en + ", " + a.name) + '"></button>';
    }).join("");

    var notice = "";
    if (state.view === "ditwah") {
      notice = '<p class="notice">This replays real rainfall and river flow recorded around Cyclone Ditwah (24 Nov to 3 Dec 2025), read as if it were the forecast on 27 Nov. The numbers come from Open-Meteo\'s archive and GloFAS, not from the forecasts that were issued at the time.</p>';
    } else if (state.view === "date") {
      notice = '<p class="notice">' + (set.archive ? "Past rainfall here is recorded data from Open-Meteo's archive, not the forecast issued at the time. " : "") +
        (set.time[TODAY] > addDays(isoToday(), 7) ? "Forecasts more than a week ahead are rough, so treat these levels loosely. " : "") +
        "Risk levels treat " + esc(fmtDay(set.time[TODAY], true)) + " as \"today\". Press Now to go back to the live outlook.</p>";
    } else if (!set.live && !state.loading) {
      notice = '<p class="notice">The live weather services could not be reached from this page, so it is showing data saved on ' + esc(fmtStamp(set.fetchedAt)) + '. Deployed on its own domain, the site fetches fresh data on every visit.</p>';
    }

    $("lede").innerHTML = "<h1>" + esc(title) + "</h1><p>" + line + "</p>" +
      '<div class="units" aria-label="Every district, highest risk first">' + units + "</div>" +
      '<p class="units-key">Each square is one district, highest risk first.</p>' + notice;
  }

  function renderDetail() {
    var set = current();
    var i = D.findIndex(function (d) { return d.id === state.sel; });
    var a = set.assess[i], d = a.d;
    var others = ["en", "si", "ta"].filter(function (l) { return l !== state.lang; });
    var flowNote = a.rise === null ? "no data" : (a.rise >= 1.15 ? "rising, " + a.rise.toFixed(1) + "x today" : a.rise <= 0.9 ? "falling from today" : "steady");
    var html =
      '<div class="d-head"><div><h2 class="d-name"' + langAttr(state.lang) + ">" + esc(nameOf(d)) + "</h2>" +
      '<div class="d-alt">' + others.map(function (l) { return "<span" + langAttr(l) + ">" + esc(nameOf(d, l)) + "</span>"; }).join("") +
      (d.ls ? '<span class="ls">Landslide-prone district</span>' : "") + "</div></div>" +
      '<span class="badge l' + a.level + '">' + a.name + "</span></div>" +
      '<ul class="d-why">' + a.reasons.map(function (r) { return "<li>" + esc(r.charAt(0).toUpperCase() + r.slice(1)) + "</li>"; }).join("") + "</ul>" +
      '<dl class="figs">' +
      "<div><dt>Wettest day ahead</dt><dd>" + mm(a.peak) + "<small>mm</small></dd><dt>" + fmtDay(set.time[a.peakIdx], true) + (a.prob !== null ? ", " + a.prob + "% chance of rain" : "") + "</dt></div>" +
      "<div><dt>Last 3 days</dt><dd>" + mm(a.past3) + "<small>mm</small></dd><dt>already fallen</dt></div>" +
      "<div><dt>Next 7 days</dt><dd>" + mm(a.week) + "<small>mm</small></dd><dt>total expected</dt></div>" +
      "<div><dt>River flow, next 3 days</dt><dd>" + (a.rise === null ? "–" : mm(a.flowPeak) + "<small>m³/s</small>") + "</dd><dt>" + flowNote + "</dt></div>" +
      "</dl>" +
      '<div class="chart"><h3>Daily rain, 3 days before and 7 from ' + (state.view === "now" ? "today" : fmtDay(set.time[TODAY], true)) + '. Click a day to map it.</h3>' + rainChart(set, i) + "</div>" +
      (set.flow ? '<div class="flow"><h3>River flow near the district centre (GloFAS model)</h3>' + flowChart(set, i) + "</div>" : "");
    $("detail").innerHTML = html;
  }

  function chartW() { return Math.max(300, Math.round($("detail").clientWidth || 640)); }

  function rainChart(set, i) {
    var r = set.rain[i], W = chartW(), H = W < 480 ? 210 : 240, padL = 2, padR = 56, padT = 22, padB = 40, narrow = W < 480;
    var max = Math.max(160, Math.max.apply(null, r) * 1.12);
    var cw = (W - padL - padR) / r.length, bw = cw * 0.62;
    var y = function (v) { return padT + (H - padT - padB) * (1 - v / max); };
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Bar chart of daily rainfall">';
    var lastLabelY = Infinity;
    [50, 100, 150].concat(max > 260 ? [250] : []).forEach(function (t) {
      out += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="var(--rule)" stroke-dasharray="3 4"/>';
      if (lastLabelY - y(t) >= 15) { out += '<text x="' + (W - padR + 6) + '" y="' + (y(t) + 4) + '" font-size="12">' + t + " mm</text>"; lastLabelY = y(t); }
    });
    out += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--ink)"/>';
    var tx = padL + cw * TODAY;
    out += '<rect x="' + tx + '" y="' + (padT - 18) + '" width="' + cw + '" height="' + (H - padT - padB + 18) + '" fill="var(--paper)"/>';
    if (state.mode === "day" && state.day !== TODAY) out += '<rect x="' + (padL + cw * state.day) + '" y="' + (padT - 18) + '" width="' + cw + '" height="' + (H - padT - padB + 18) + '" fill="var(--rule-soft)"/>';
    r.forEach(function (v, k) {
      out += '<rect class="hit" data-day="' + k + '" x="' + (padL + cw * k) + '" y="' + (padT - 18) + '" width="' + cw + '" height="' + (H - padT + 18) + '" fill="transparent"><title>Show ' + fmtDay(set.time[k], true) + " on the map</title></rect>";
    });
    r.forEach(function (v, k) {
      var x = padL + cw * k + (cw - bw) / 2, h = Math.max(0, y(0) - y(v || 0));
      var lvl = Risk.fromRain(v || 0, D[i].ls);
      var fill = k < TODAY ? "var(--r2)" : lvl ? LVL[lvl] : "var(--r4)";
      var on = state.mode === "day" && state.day === k;
      out += '<rect pointer-events="none" x="' + x + '" y="' + (y(0) - h) + '" width="' + bw + '" height="' + h + '" rx="1.5" fill="' + fill + '"' + (k < TODAY && !on ? ' opacity="0.6"' : "") + (on ? ' stroke="var(--ink)" stroke-width="2"' : "") + "/>";
      if (v >= 0.5 && (!narrow || v >= 1)) out += '<text x="' + (x + bw / 2) + '" y="' + (y(0) - h - 6) + '" font-size="12" text-anchor="middle" fill="var(--ink)" pointer-events="none">' + mm(v) + "</text>";
      out += '<text x="' + (x + bw / 2) + '" y="' + (H - padB + 17) + '" font-size="12" text-anchor="middle"' + (k === TODAY || (state.mode === "day" && state.day === k) ? ' fill="var(--ink)" font-weight="700"' : "") + ' pointer-events="none">' + (k === TODAY ? (state.view === "now" ? (narrow ? "Now" : "Today") : (narrow ? "Day" : "Chosen")) : new Date(set.time[k] + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short" })) + "</text>" +
        '<text x="' + (x + bw / 2) + '" y="' + (H - padB + 33) + '" font-size="11" text-anchor="middle" pointer-events="none">' + (narrow ? String(+set.time[k].slice(8)) : fmtDay(set.time[k])) + "</text>";
    });
    return out + "</svg>";
  }

  function flowChart(set, i) {
    var q = set.flow[i], W = chartW(), H = 120, padL = 2, padR = 56, padT = 20, padB = 14;
    var max = Math.max.apply(null, q) * 1.15 || 1;
    var cw = (W - padL - padR) / q.length;
    var x = function (k) { return padL + cw * k + cw / 2; };
    var y = function (v) { return padT + (H - padT - padB) * (1 - v / max); };
    var pts = q.map(function (v, k) { return x(k) + "," + y(v); }).join(" ");
    var peak = q.indexOf(Math.max.apply(null, q));
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Line chart of river flow">';
    out += '<rect x="' + (padL + cw * TODAY) + '" y="0" width="' + cw + '" height="' + (H - padB) + '" fill="var(--paper)"/>';
    out += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--ink)"/>';
    out += '<polyline points="' + pts + '" fill="none" stroke="var(--r4)" stroke-width="2.5" stroke-linejoin="round"/>';
    q.forEach(function (v, k) { out += '<circle cx="' + x(k) + '" cy="' + y(v) + '" r="' + (k === peak || k === 0 ? 4 : 2.5) + '" fill="var(--r4)"/>'; });
    [[0, "start"], [peak, peak === 0 ? null : "middle"]].forEach(function (p) {
      if (!p[1]) return;
      out += '<text x="' + x(p[0]) + '" y="' + (y(q[p[0]]) - 9) + '" font-size="12" text-anchor="' + p[1] + '" fill="var(--ink)">' + mm(q[p[0]]) + " m³/s</text>";
    });
    return out + "</svg>";
  }

  function renderRows() {
    var set = current(), list = ranked(set.assess);
    var dayMode = state.mode === "day";
    if (dayMode) list = set.assess.slice().sort(function (a, b) { return dayRain(b.i) - dayRain(a.i) || a.d.en.localeCompare(b.d.en); });
    $("h-all").textContent = dayMode ? "Rain on " + fmtDay(set.time[state.day], true) : "All 25 districts";
    document.querySelector("#h-all + .hint").textContent = dayMode
      ? "Wettest first. The level badge is still the 3-day outlook; press Risk level above the map to go back."
      : "Sorted by risk, then by the wettest day ahead. Bars show 10 days; the dark ones are forecast.";
    $("rows").innerHTML = list.map(function (a, n) {
      var r = set.rain[a.i], top = Math.max(50, Math.max.apply(null, r));
      var bars = r.map(function (v, k) { return '<i class="' + (k < TODAY ? "past" : "") + '" style="height:' + Math.max(2, (v || 0) / top * 100) + "%" + (dayMode && k === state.day ? ";background:var(--ink);opacity:1" : "") + '"></i>'; }).join("");
      var tr = a.rise === null ? "" : a.rise >= 1.15 ? "rising " + a.rise.toFixed(1) + "x" : a.rise <= 0.9 ? "falling" : "steady";
      return '<li><button type="button" data-id="' + a.d.id + '" class="' + (a.d.id === state.sel ? "sel" : "") + '">' +
        '<span class="n">' + (n + 1) + "</span>" +
        '<span class="nm"' + langAttr(state.lang) + ">" + esc(nameOf(a.d)) + "</span>" +
        '<span><span class="chip l' + a.level + '">' + a.name + "</span></span>" +
        '<span class="mm">' + mm(dayMode ? dayRain(a.i) : a.peak) + " <small>mm</small></span>" +
        '<span class="spark" aria-hidden="true">' + bars + "</span>" +
        '<span class="tr">' + tr + "</span></button></li>";
    }).join("");
  }

  function renderHazards() {
    var set = state.sets.now;
    var items = [];
    (set.events || []).slice().sort(function (a, b) { return (b.current - a.current) || b.from.localeCompare(a.from); }).forEach(function (e) {
      var kind = { FL: "Flood", TC: "Cyclone", EQ: "Earthquake" }[e.type] || e.type;
      items.push('<li><span class="k">' + kind + (e.current ? ", active" : ", past") + "</span><span>" +
        (e.url ? '<a href="' + esc(e.url) + '">' + esc(e.name) + "</a>" : esc(e.name)) + " · GDACS " + esc(e.level) + " alert</span>" +
        '<span class="w">' + fmtDay(e.from.slice(0, 10)) + " to " + fmtDay(e.to.slice(0, 10)) + " " + e.to.slice(0, 4) + "</span></li>");
    });
    (set.quakes || []).forEach(function (q) {
      items.push('<li><span class="k">Earthquake</span><span><a href="' + esc(q.url) + '">Magnitude ' + q.mag.toFixed(1) + "</a>, " + esc(q.place) +
        ", about " + km(CENTRE, q).toLocaleString("en-GB") + ' km from Sri Lanka\'s centre</span><span class="w">' +
        new Date(q.time).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + "</span></li>");
    });
    if (!set.quakes) items.push('<li><span class="empty">Earthquake feed unavailable right now.</span></li>');
    else if (!set.quakes.length) items.push('<li><span class="empty">No magnitude 4+ earthquakes in the region in the last 30 days.</span></li>');
    $("hazards").innerHTML = items.join("");
  }

  function fillPicker() {
    $("picker").innerHTML = D.slice().sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b)); }).map(function (d) {
      return '<option value="' + d.id + '"' + (d.id === state.sel ? " selected" : "") + ">" + esc(nameOf(d)) + "</option>";
    }).join("");
  }

  function renderDays() {
    var set = current(), tday = isoToday();
    $("days").innerHTML = set.time.map(function (iso, k) {
      var vals = set.rain.map(function (r) { return r[k] || 0; });
      var top = Math.max.apply(null, vals);
      var isToday = state.view === "now" && k === TODAY;
      var cls = (iso < tday ? "past " : "") + (k === TODAY ? "anchor" : "");
      var on = state.mode === "day" && state.day === k;
      var dt = new Date(iso + "T00:00:00");
      return '<button type="button" data-day="' + k + '" class="' + cls + '" aria-pressed="' + on + '" aria-label="Rain on ' + esc(dt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })) + ", wettest district " + mm(top) + ' mm">' +
        '<span class="dw">' + (isToday ? "Today" : dt.toLocaleDateString("en-GB", { weekday: "short" })) + "</span>" +
        '<span class="dn">' + dt.getDate() + "</span>" +
        '<span class="heat" style="background:' + stepColor(DAY_STEPS, top) + '"></span></button>';
    }).join("");
    var dp = $("datePick");
    dp.max = addDays(tday, 15);
    dp.value = set.time[state.mode === "day" ? state.day : TODAY];
    if (state.mode === "day") {
      var vals = set.rain.map(function (r, i) { return { i: i, v: r[state.day] || 0 }; }).sort(function (x, y) { return y.v - x.v; });
      var avg = vals.reduce(function (s, x) { return s + x.v; }, 0) / vals.length;
      var wet = vals.filter(function (x) { return x.v >= 50; }).length;
      setMsg(fmtDay(set.time[state.day], true) + ": wettest is <span" + langAttr(state.lang) + ">" + esc(nameOf(D[vals[0].i])) + "</span> with " + mm(vals[0].v) + " mm. Island average " + mm(avg) + " mm" + (wet ? ", " + wet + (wet === 1 ? " district" : " districts") + " over 50 mm." : "."));
    } else if (!$("dayMsg").classList.contains("err") && !$("dayMsg").dataset.busy) {
      setMsg("Tap a day to colour the map by that day's rain.");
    }
  }
  function setMsg(html, isErr) { var m = $("dayMsg"); m.innerHTML = html; m.classList.toggle("err", !!isErr); }

  function setDay(k) {
    state.mode = "day"; state.day = k;
    setPressed("mode", "day");
    paintMap(); renderRows(); renderDetail(); renderDays();
  }

  function loadDate(iso) {
    var tday = isoToday();
    var start = addDays(iso, -3), end = addDays(iso, 6);
    if (end > addDays(tday, 15)) end = addDays(tday, 15);
    var archive = end < addDays(tday, -5);
    var lat = D.map(function (d) { return d.lat; }).join(",");
    var lon = D.map(function (d) { return d.lon; }).join(",");
    var range = "&start_date=" + start + "&end_date=" + end;
    var rainUrl = archive
      ? "https://archive-api.open-meteo.com/v1/archive?latitude=" + lat + "&longitude=" + lon + range + "&daily=precipitation_sum&timezone=Asia%2FColombo"
      : "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon + range + "&daily=precipitation_sum,precipitation_probability_max&timezone=Asia%2FColombo";
    var flood = iso >= "1984-01-01"
      ? withTimeout("https://flood-api.open-meteo.com/v1/flood?latitude=" + lat + "&longitude=" + lon + range + "&daily=river_discharge", 12000).catch(function () { return null; })
      : Promise.resolve(null);
    return Promise.all([withTimeout(rainUrl, 12000), flood]).then(function (r) {
      var w = r[0], f = r[1];
      if (!Array.isArray(w) || w.length !== D.length) throw new Error("Unexpected response");
      return {
        archive: archive, fetchedAt: new Date().toISOString(),
        time: w[0].daily.time,
        rain: w.map(function (x) { return x.daily.precipitation_sum; }),
        prob: archive ? null : w.map(function (x) { return x.daily.precipitation_probability_max; }),
        flow: Array.isArray(f) ? f.map(function (x) { return x.daily.river_discharge; }) : null
      };
    });
  }

  function goToDate(iso) {
    if (!iso) return;
    var tday = isoToday(), max = addDays(tday, 15);
    if (iso < "1940-01-01" || iso > max) { setMsg("Pick a date between 1 Jan 1940 and " + fmtDay(max) + " " + max.slice(0, 4) + ".", true); return; }
    var k = current().time.indexOf(iso);
    if (k !== -1) { setMsg(""); setDay(k); return; }
    var m = $("dayMsg"); m.dataset.busy = "1"; setMsg("Loading rain around " + fmtDay(iso, true) + " " + iso.slice(0, 4) + "…");
    loadDate(iso).then(function (set) {
      delete m.dataset.busy; setMsg("");
      set.assess = assessSet(set);
      state.sets.date = set; state.view = "date";
      setPressed("view", "date");
      state.mode = "day"; state.day = TODAY; setPressed("mode", "day");
      renderAll();
    }).catch(function () {
      delete m.dataset.busy;
      var dk = SNAP.ditwah.time.indexOf(iso);
      if (dk !== -1) {
        state.view = "ditwah"; setPressed("view", "ditwah");
        state.mode = "day"; state.day = dk; setPressed("mode", "day");
        renderAll();
        return;
      }
      setMsg("Couldn't load that date. Other dates need a live connection, which works on localhost or once the site is deployed.", true);
    });
  }

  function renderAll() {
    renderStatus(); renderDays(); renderLede(); renderDetail(); renderRows(); renderHazards(); paintMap(); fillPicker();
  }

  function select(id, fromUser) {
    if (!D.some(function (d) { return d.id === id; })) return;
    state.sel = id;
    try { history.replaceState(null, "", "#" + id); } catch (e) { /* sandboxed frames may refuse */ }
    renderLede(); renderDetail(); renderRows(); paintMap(); fillPicker();
    if (fromUser) {
      var det = $("detail"), rect = det.getBoundingClientRect();
      var barH = document.querySelector(".bar").offsetHeight;
      if (rect.top < barH || rect.top > window.innerHeight * 0.6) {
        window.scrollTo({ top: window.scrollY + rect.top - barH - 12, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
    }
  }

  function setPressed(attr, val) {
    document.querySelectorAll("[data-" + attr + "]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset[attr] === val)); });
  }

  function wire() {
    document.addEventListener("click", function (e) {
      var hit = e.target.closest("[data-day]");
      if (hit) { setDay(+hit.dataset.day); return; }
      var b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.view && b.dataset.view !== state.view) {
        state.view = b.dataset.view; setPressed("view", state.view);
        if (state.mode === "day") { state.mode = "risk"; state.day = null; setPressed("mode", "risk"); }
        setMsg("");
        if (!location.hash || state.view === "ditwah") state.sel = ranked(current().assess)[0].d.id;
        renderAll();
      } else if (b.dataset.lang) {
        state.lang = b.dataset.lang; setPressed("lang", state.lang); renderAll();
      } else if (b.dataset.mode) {
        state.mode = b.dataset.mode; state.day = null; setPressed("mode", state.mode);
        paintMap(); renderRows(); renderDetail(); renderDays();
      } else if (b.dataset.id) {
        select(b.dataset.id, true);
      }
    });
    $("picker").addEventListener("change", function (e) { select(e.target.value, true); });
    $("datePick").addEventListener("change", function (e) { goToDate(e.target.value); });
    var lastW = window.innerWidth, rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (Math.abs(window.innerWidth - lastW) > 40) { lastW = window.innerWidth; renderDetail(); } }, 150);
    });
    window.addEventListener("hashchange", function () { var id = location.hash.slice(1); if (id !== state.sel) select(id, false); });
  }

  function useNow(set) {
    set.assess = assessSet(set);
    state.sets.now = set;
  }

  function start() {
    var cfg = window.WESSA_CONFIG || {};
    if (cfg.telegramBot) {
      $("botLink").href = "https://t.me/" + encodeURIComponent(cfg.telegramBot);
      $("botLink").textContent = "Open @" + cfg.telegramBot + " on Telegram";
      $("alertsBlock").hidden = false;
    }
    buildMap();
    wire();
    var dit = SNAP.ditwah; dit.assess = assessSet(dit); state.sets.ditwah = dit;
    var saved = SNAP.now; saved.live = false;
    useNow(saved);
    var hashId = location.hash.slice(1);
    state.sel = D.some(function (d) { return d.id === hashId; }) ? hashId : ranked(saved.assess)[0].d.id;
    renderAll();

    function refresh() {
      loadLive().then(function (live) {
        state.loading = false;
        useNow(live);
        if (!hashId && state.view === "now") state.sel = ranked(live.assess)[0].d.id;
        if (state.view === "now") { if (state.mode === "day" && state.day >= live.time.length) { state.mode = "risk"; state.day = null; setPressed("mode", "risk"); } renderAll(); } else renderHazards();
      }).catch(function () {
        state.loading = false;
        if (state.view === "now") renderAll();
      });
    }
    refresh();
    setInterval(refresh, 30 * 60 * 1000);
  }

  start();
})();
