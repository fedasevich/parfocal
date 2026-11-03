import assert from "node:assert/strict";
import { test } from "node:test";
import type { LabSettings } from "@parfocal/api-client";
import { toModelTiers } from "@parfocal/api-client/fake";
import {
  defaultChange,
  defaultsOf,
  durationText,
  endsAtFor,
  isAnnouncementText,
  modelsForTask,
  NOT_CHOSEN,
  tierCell,
  withCurrent,
} from "../src/screens/admin/workspace-settings-model.ts";

const lab: LabSettings = {
  values: { default_privacy_mode: "clinical", lock_after_minutes: 20 },
  locked: ["lock_after_minutes"],
};

test("a workspace with nothing saved starts new work de-identified, with no classes or template", () => {
  assert.deepEqual(defaultsOf({ values: {}, locked: [] }), {
    privacy: "de-identified",
    classes: "none",
    template: "",
  });
  assert.equal(defaultsOf(lab).privacy, "clinical");
});

test("saving one default sends only it and keeps every lock the workspace has", () => {
  assert.deepEqual(defaultChange(lab, "default_classes", "pannuke"), {
    values: { default_classes: "pannuke" },
    locked: ["lock_after_minutes"],
  });
  assert.deepEqual(defaultChange(lab, "default_study_template", ""), {
    values: { default_study_template: null },
    locked: ["lock_after_minutes"],
  });
});

test("lock times read as minutes or hours and keep a value the list does not offer", () => {
  assert.equal(durationText(15), "15 minutes");
  assert.equal(durationText(60), "1 hour");
  assert.equal(durationText(120), "2 hours");
  assert.equal(durationText(90), "90 minutes");
  assert.deepEqual(withCurrent([5, 15, 30], 20), [5, 15, 20, 30]);
  assert.deepEqual(withCurrent([5, 15, 30], 15), [5, 15, 30]);
});

test("a tier offers only models that make what its task needs", () => {
  assert.deepEqual(
    modelsForTask("tumor").map((model) => model.name),
    ["camelyon-tumor", "pathosam-hovernext"],
  );
  assert.deepEqual(
    modelsForTask("outline").map((model) => model.name),
    ["pathosam-hovernext", "hovernet"],
  );
});

test("a tier shows the lab's choice or says it is Parfocal's", () => {
  const mappings = toModelTiers();
  assert.equal(tierCell(mappings, "outline", "best").value, NOT_CHOSEN);
  const chosen = mappings.map((mapping) =>
    mapping.task === "tumor" && mapping.tier === "good"
      ? {
          ...mapping,
          set_by_lab: true,
          model: {
            name: "camelyon-tumor",
            version: "v1.0",
            title: "CAMELYON tumor model",
            description: "",
            label: "CAMELYON tumor model · v1.0",
          },
        }
      : mapping,
  );
  assert.deepEqual(tierCell(chosen, "tumor", "good"), {
    value: "camelyon-tumor",
    shown: "CAMELYON tumor model · v1.0",
  });
});

test("an announcement ends when the person says, and needs some text", () => {
  const from = new Date("2026-10-15T12:00:00Z");
  assert.equal(endsAtFor("never", from), null);
  assert.equal(endsAtFor("hour", from), "2026-10-15T13:00:00.000Z");
  assert.equal(endsAtFor("week", from), "2026-10-22T12:00:00.000Z");
  assert.equal(isAnnouncementText("   "), false);
  assert.equal(isAnnouncementText("x".repeat(281)), false);
  assert.equal(isAnnouncementText("Rounds move to 09:00"), true);
});
