import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  bringWorkersBack,
  takeWorkersOffline,
  toAiModels,
  toModelTiers,
  toProjectModels,
} from "@parfocal/api-client/fake";
import { modelStatus } from "../src/screens/admin/model-status.ts";
import { runEstimate } from "../src/screens/jobs/model.ts";
import { tiersFor } from "../src/screens/viewer-tools/model-tiers.ts";

afterEach(bringWorkersBack);

test("with every worker answering no tier or model is offline", () => {
  assert.ok(tiersFor(toModelTiers(), "outline").every((tier) => tier.offline === false));
  assert.ok(toProjectModels().every((model) => model.serving === "ready"));
  assert.ok(toAiModels().models.every((model) => model.status !== "offline"));
});

test("a worker outage marks the tier, the run picker model and the admin list offline", () => {
  takeWorkersOffline("pathosam-hovernext");
  const outline = tiersFor(toModelTiers(), "outline");
  assert.deepEqual(
    outline.map((tier) => [tier.name, tier.offline]),
    [
      ["Best", true],
      ["Good", false],
      ["Fast", false],
    ],
  );
  const offlineModels = toProjectModels().filter((model) => model.serving === "offline");
  assert.deepEqual(
    offlineModels.map((model) => model.name),
    ["pathosam-hovernext"],
  );
  const listed = toAiModels().models.find((model) => model.catalogue_name === "pathosam-hovernext");
  assert.ok(listed);
  assert.equal(listed.status, "offline");
  assert.equal(listed.latency_ms, null);
  assert.deepEqual(modelStatus(listed), { text: "Offline", tone: "bad" });
});

test("a lab server outage turns its answering status into offline", () => {
  const answering = toAiModels().models.find((model) => model.status === "answering");
  assert.ok(answering);
  takeWorkersOffline("lab-hovernet-fork");
  const down = toAiModels().models.find((model) => model.id === answering.id);
  assert.equal(down?.status, "offline");
  const labModel = toProjectModels().find((model) => model.host === "lab");
  assert.ok(labModel);
  assert.equal(labModel.serving, "offline");
  assert.match(runEstimate(labModel, 2, new Date(2026, 9, 15, 14, 30)).perSlide, /not answering/);
});

test("the answer comes back when the worker does", () => {
  takeWorkersOffline("hovernet");
  bringWorkersBack();
  assert.ok(toProjectModels().every((model) => model.serving === "ready"));
  assert.ok(tiersFor(toModelTiers(), "outline").every((tier) => tier.offline === false));
});
