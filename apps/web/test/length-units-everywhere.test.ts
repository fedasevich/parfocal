import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ReviewObject } from "@parfocal/api-client";
import {
  defaultFakeView,
  scenario,
  setFakeView,
  toClinicalReport,
} from "@parfocal/api-client/fake";
import {
  applySavedLengthUnits,
  formatMillimetres,
  lengthUnitsNow,
  setLengthUnits,
} from "../src/measure/length-units.ts";
import { diagnosisOf, mmText, sceneReport } from "../src/screens/clinical-report/model.ts";
import { agreeWithTheAi } from "../src/screens/review/decision-mapping.ts";
import { cardText } from "../src/screens/review/decision-style.ts";

afterEach(() => {
  setFakeView(defaultFakeView);
  setLengthUnits("auto");
});

const region = { kind: "region", class_name: "Tumor", size_mm: 1.5 } as unknown as ReviewObject;

test("the objects panel and review lists show millimetres in auto and micrometres in always um", () => {
  assert.equal(formatMillimetres(1.5, 1, "auto"), "1.5 mm");
  assert.equal(formatMillimetres(1.5, 1, "um"), "1500 µm");
  assert.equal(formatMillimetres(0.45, 2, "auto"), "0.45 mm");
  assert.equal(formatMillimetres(0.45, 2, "um"), "450 µm");
  assert.equal(formatMillimetres(5, 1, "um"), "5000 µm");
});

test("the review card context follows the setting", () => {
  const context = () => cardText(agreeWithTheAi, region, "number").context;
  setLengthUnits("auto");
  assert.equal(context(), "1.5 mm across");
  setLengthUnits("um");
  assert.equal(context(), "1500 µm across");
});

test("the clinical report sizes and diagnosis follow the setting", () => {
  const slide = scenario.slideOf("P07", "S26-04812", "A1").id;
  const report = sceneReport(toClinicalReport(slide), "staging");
  setLengthUnits("auto");
  assert.equal(mmText(8), "8.0 mm");
  assert.equal(mmText(0.9), "0.90 mm");
  assert.match(diagnosisOf(toClinicalReport(slide), report.values), /8\.0 mm/);
  setLengthUnits("um");
  assert.equal(mmText(8), "8000 µm");
  assert.equal(mmText(0.9), "900 µm");
  assert.match(diagnosisOf(toClinicalReport(slide), report.values), /8000 µm/);
});

test("a saved server value is applied at start without opening Settings", () => {
  setLengthUnits("auto");
  assert.equal(lengthUnitsNow(), "auto");
  applySavedLengthUnits("um");
  assert.equal(lengthUnitsNow(), "um");
  assert.equal(mmText(2.5), "2500 µm");
  applySavedLengthUnits("auto");
  assert.equal(lengthUnitsNow(), "auto");
  applySavedLengthUnits(undefined);
  assert.equal(lengthUnitsNow(), "auto");
});
