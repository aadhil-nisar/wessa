// Quick checks for the risk rules: `npm test` (no Firebase needed).
const assert = require("assert");
const { assess } = require("./risk.js");

const flat = (v) => Array(10).fill(v);
const rainWith = (todayValue, past = 0) => [past, past, past, todayValue, 0, 0, 0, 0, 0, 0];

assert.strictEqual(assess({ rain: flat(0) }).level, 0, "dry is Normal");
assert.strictEqual(assess({ rain: rainWith(60) }).level, 1, "60 mm is Watch");
assert.strictEqual(assess({ rain: rainWith(80) }).level, 1, "80 mm is Watch outside landslide areas");
assert.strictEqual(assess({ rain: rainWith(80), landslideProne: true }).level, 2, "80 mm is Warning in landslide areas");
assert.strictEqual(assess({ rain: rainWith(120) }).level, 2, "120 mm is Warning");
assert.strictEqual(assess({ rain: rainWith(160) }).level, 3, "160 mm is Severe");
assert.strictEqual(assess({ rain: rainWith(60, 60) }).level, 2, "soaked ground adds a level");
assert.strictEqual(assess({ rain: flat(0), flow: [5, 5, 5, 20, 35, 30, 20, 10, 8, 6] }).level, 1, "flow 1.75x today is Watch");
assert.strictEqual(assess({ rain: flat(0), flow: [5, 5, 5, 20, 60, 30, 20, 10, 8, 6] }).level, 2, "flow 3x today is Warning");
assert.strictEqual(assess({ rain: flat(0), flow: [1, 1, 1, 2, 6, 3, 2, 1, 1, 1] }).level, 0, "tiny streams are ignored");

console.log("All risk rule checks passed");
