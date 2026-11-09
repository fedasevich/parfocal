import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsCatalogue, type TrackRecord } from "@parfocal/api-client";
import {
  decisionCutoffChange,
  decisionCutoffOf,
} from "../src/screens/admin/workspace-settings-model.ts";
import { sectionRows } from "../src/screens/settings/sections.ts";
import { wordingExample } from "../src/screens/settings/wording-example.ts";
import { calibrationLines, trackRecordLines } from "../src/screens/viewer/ai-record-lines.ts";
import { outlineModeChoices } from "../src/viewer/outline-mode.ts";

test("the AI section lists every setting it drives and scopes the cutoff to the lab", () => {
  const rows = Object.fromEntries(sectionRows.ai.map((row) => [row.key, row.scope]));
  assert.deepEqual(rows, {
    outlineMode: "personal",
    confidenceWording: "personal",
    defaultPreset: "personal",
    decisionCutoff: "lab",
    tierOutline: "personal",
    modelWarnings: "personal",
    trackRecord: "personal",
    calibration: "personal",
  });
});

test("the catalogue offers the viewer's outline modes and keeps the cutoff lab-only", () => {
  assert.deepEqual(settingsCatalogue.outline_mode.options, [...outlineModeChoices]);
  assert.deepEqual(settingsCatalogue.decision_cutoff.layers, ["lab"]);
  assert.deepEqual(settingsCatalogue.tier_outline.options, ["best", "good", "fast"]);
  assert.equal(settingsCatalogue.inspector_track_record.default, true);
  assert.equal(settingsCatalogue.inspector_calibration.default, true);
});

test("the live example follows the chosen wording", () => {
  assert.match(wordingExample("words"), /tumor/i);
  assert.match(wordingExample("numbers"), /72%/);
  assert.match(wordingExample("colour"), /colour/);
  assert.match(wordingExample("hidden"), /Nothing/);
});

test("the workspace cutoff change keeps the locks and reads back as a number", () => {
  const lab = { values: { decision_cutoff: 70 }, locked: ["patient_names"] };
  assert.equal(decisionCutoffOf(lab), 70);
  assert.equal(decisionCutoffOf({ values: {}, locked: [] }), 50);
  assert.deepEqual(decisionCutoffChange(lab, 40), {
    values: { decision_cutoff: 40 },
    locked: ["patient_names"],
  });
});

test("the track record and calibration blocks say nothing without evidence", () => {
  assert.deepEqual(trackRecordLines(undefined, "typer"), []);
  assert.deepEqual(calibrationLines(undefined), []);
  const record = {
    typers: [{ typer: "typer", checked: 10, kept: 8, overall_kept_share: 0.81 }],
  } as unknown as TrackRecord;
  assert.equal(trackRecordLines(record, "typer")[0], "You kept 8 of the 10 calls you checked.");
  assert.deepEqual(trackRecordLines(record, "other"), []);
});
