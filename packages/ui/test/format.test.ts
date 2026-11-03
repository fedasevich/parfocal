import assert from "node:assert/strict";
import { test } from "node:test";
import { createFormat, defaultFormatSettings, tabularFigures } from "../src/lib/format.ts";

const en = createFormat();
const enMicrons = createFormat({ language: "en", lengths: "um" });
const cs = createFormat({ language: "cs", lengths: "auto" });
const at = new Date(2026, 10, 3, 14, 5, 9);

test("the default settings are English with automatic lengths", () => {
  assert.deepEqual(defaultFormatSettings, { language: "en", lengths: "auto" });
  assert.equal(en.locale, "en-GB");
  assert.equal(cs.locale, "cs-CZ");
});

test("numbers group thousands and take fixed decimals", () => {
  assert.equal(en.number(1234567), "1,234,567");
  assert.equal(en.number(1234.5, { grouping: false }), "1234.5");
  assert.equal(en.number(0.5, { decimals: 2 }), "0.50");
  assert.equal(en.number(0.456, { decimals: 2 }), "0.46");
  assert.equal(en.integer(41.6), "42");
  assert.equal(cs.number(0.25, { decimals: 2 }), "0,25");
});

test("percentages come from a fraction, from points and from a part of a whole", () => {
  assert.equal(en.percent(0.456), "46%");
  assert.equal(en.percent(0.456, 1), "45.6%");
  assert.equal(en.percentPoints(72), "72%");
  assert.equal(en.percentPoints(72.34, 1), "72.3%");
  assert.equal(en.percentOf(1, 3), "33%");
  assert.equal(en.percentOf(5, 0), "0%");
  assert.match(cs.percent(0.45), /^45\s%$/);
});

test("dates read the same way in every screen", () => {
  assert.equal(en.date(at), "3 Nov 2026");
  assert.equal(en.dateShort(at), "3 Nov");
  assert.equal(en.dateLong(at), "3 November 2026");
  assert.equal(en.weekday(at), "Tuesday");
  assert.equal(en.time(at), "14:05");
  assert.equal(en.dateTime(at), "3 Nov 2026, 14:05");
});

test("dates follow the language", () => {
  assert.equal(cs.weekday(at), "úterý");
  assert.match(cs.dateLong(at), /^3\. listopadu 2026$/);
  assert.equal(cs.time(at), "14:05");
});

test("the clock is 24 hours and pads the hour", () => {
  assert.equal(en.time(new Date(2026, 10, 3, 0, 7)), "00:07");
  assert.equal(en.time(new Date(2026, 10, 3, 9, 30)), "09:30");
});

test("durations pick the unit that reads shortest", () => {
  assert.equal(en.duration(-5), "0 ms");
  assert.equal(en.duration(850), "850 ms");
  assert.equal(en.duration(1000), "1 s");
  assert.equal(en.duration(1240), "1.2 s");
  assert.equal(en.duration(59_000), "59 s");
  assert.equal(en.duration(60_000), "1 min");
  assert.equal(en.duration(125_000), "2 min 5 s");
  assert.equal(en.duration(3_600_000), "1 h");
  assert.equal(en.duration(3_900_000), "1 h 5 min");
  assert.equal(cs.duration(1240), "1,2 s");
});

test("lengths in microns switch to millimetres from 1000 in automatic mode", () => {
  assert.equal(en.length(10), "10 µm");
  assert.equal(en.length(0.25), "0.25 µm");
  assert.equal(en.length(999), "999 µm");
  assert.equal(en.length(1000), "1 mm");
  assert.equal(en.length(2500), "2.5 mm");
  assert.equal(en.length(5000), "5 mm");
  assert.equal(en.length(1234567), "1234.57 mm");
  assert.equal(cs.length(2500), "2,5 mm");
});

test("lengths stay in microns when the setting says always microns", () => {
  assert.equal(enMicrons.length(10), "10 µm");
  assert.equal(enMicrons.length(5000), "5000 µm");
  assert.equal(enMicrons.length(2500), "2500 µm");
});

test("object sizes in millimetres keep two decimals under 1 mm and one above", () => {
  assert.equal(en.size(0.45), "0.45 mm");
  assert.equal(en.size(0.4), "0.40 mm");
  assert.equal(en.size(1), "1.0 mm");
  assert.equal(en.size(3.26), "3.3 mm");
  assert.equal(en.size(12.04), "12.0 mm");
  assert.equal(cs.size(3.26), "3,3 mm");
});

test("object sizes become whole microns when the setting says always microns", () => {
  assert.equal(enMicrons.size(0.45), "450 µm");
  assert.equal(enMicrons.size(3.26), "3260 µm");
  assert.equal(enMicrons.size(12.04), "12040 µm");
});

test("measurements never group digits so their width follows the digit count", () => {
  assert.doesNotMatch(enMicrons.length(12345), /[,\s]\d{3}/);
  assert.doesNotMatch(enMicrons.size(12.345), /[,\s]\d{3}/);
  assert.doesNotMatch(en.length(1234567), /,/);
});

test("measurements use plain digits that tabular figures can align", () => {
  const samples = [
    en.length(1234),
    en.size(3.26),
    en.duration(125_000),
    en.percent(0.45),
    cs.size(3.26),
    cs.length(10),
  ];
  for (const sample of samples) assert.match(sample, /^[\d.,\s%a-zµ]+$/i);
  assert.equal(tabularFigures, "tabular-nums");
});

test("the tabular figures class is the one the shared components already use", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../src/components/inspector.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes(tabularFigures));
});
