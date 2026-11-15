/* Wessa risk engine. Shared by the website and the backend (Node), so both always agree.
   Input for one district: 10 days of daily values where index 3 is today
   (3 past days, today, 6 forecast days).

   Levels: 0 Normal, 1 Watch, 2 Warning, 3 Severe.
   The bands follow the 24-hour rainfall approach used by landslide early-warning
   agencies. They are this project's own rules, not an official warning. */
(function (root) {
  var TODAY = 3;
  var LEVELS = [
    { key: "normal", name: "Normal" },
    { key: "watch", name: "Watch" },
    { key: "warning", name: "Warning" },
    { key: "severe", name: "Severe" }
  ];

  function sum(a) { return a.reduce(function (s, v) { return s + (v || 0); }, 0); }
  function round(v) { return Math.round(v * 10) / 10; }

  function fromRain(mm, landslideProne) {
    if (mm >= 150) return 3;
    if (mm >= 100) return 2;
    if (mm >= 75) return landslideProne ? 2 : 1;
    if (mm >= 50) return 1;
    return 0;
  }

  function assess(d) {
    var rain = d.rain, flow = d.flow || [];
    var past3 = round(sum(rain.slice(0, TODAY)));
    var window3 = rain.slice(TODAY, TODAY + 3);
    var peak = Math.max.apply(null, window3.map(function (v) { return v || 0; }));
    var peakIdx = TODAY + window3.indexOf(peak);
    var week = round(sum(rain.slice(TODAY)));
    var reasons = [];

    var level = fromRain(peak, d.landslideProne);
    if (level > 0) {
      reasons.push(round(peak) + " mm of rain expected in one day" + (d.landslideProne && peak >= 75 && peak < 100 ? ", in a landslide-prone district" : ""));
    }

    if (past3 >= 150 && peak >= 50) {
      level = Math.min(3, level + 1);
      reasons.push("ground already soaked: " + past3 + " mm fell in the last 3 days");
    }

    // River: compare the highest flow in the next 3 days with today's flow.
    var flowNow = flow[TODAY], flowPeak = 0, rise = null;
    if (flow.length) {
      flowPeak = Math.max.apply(null, flow.slice(TODAY + 1, TODAY + 4).map(function (v) { return v || 0; }));
      if (flowNow > 0) rise = flowPeak / flowNow;
      if (rise !== null && flowPeak >= 10) {
        if (rise >= 2.5) { level = Math.max(level, 2); reasons.push("river flow forecast to climb to " + rise.toFixed(1) + "x today's level"); }
        else if (rise >= 1.5) { level = Math.max(level, 1); reasons.push("river flow forecast to rise to " + rise.toFixed(1) + "x today's level"); }
      }
      flowPeak = Math.max(flowPeak, flowNow || 0);
    }

    if (!reasons.length) {
      reasons.push(peak < 10 ? "little rain expected in the next 3 days" : "rain expected, but below the " + (d.landslideProne ? "75" : "50") + " mm/day mark");
    }

    return {
      level: level,
      key: LEVELS[level].key,
      name: LEVELS[level].name,
      peak: round(peak),
      peakIdx: peakIdx,
      past3: past3,
      week: week,
      flowPeak: round(flowPeak),
      rise: rise === null ? null : Math.round(rise * 100) / 100,
      reasons: reasons
    };
  }

  var api = { assess: assess, LEVELS: LEVELS, TODAY: TODAY, fromRain: fromRain };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WessaRisk = api;
})(this);
