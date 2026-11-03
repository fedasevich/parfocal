import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  fakeApiHandlers,
  resetConsoleActions,
  resetSettingsActions,
  scenarioReview,
} from "../src/fake/index.ts";
import {
  createAnnouncement,
  endAnnouncement,
  endOtherSessions,
  getGetMySettingsQueryOptions,
  getMySettingLayers,
  getMySettings,
  getSessionPolicy,
  isDraftMeta,
  listAnnouncements,
  listModelTiers,
  listNotificationPreferences,
  listSessions,
  resetModelTier,
  setModelTier,
  setWorkspaceSettings,
  updateSessionPolicy,
} from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => {
  resetSettingsActions();
  resetConsoleActions();
});

after(() => {
  server.close();
  globalThis.fetch = patchedFetch;
});

test("getMySettings is a draft that answers with the scenario's settings", async () => {
  assert.equal(isDraftMeta(getGetMySettingsQueryOptions().meta), true);
  const { data } = await getMySettings();
  assert.equal(data.personal.default_preset, "task");
  assert.equal(data.shortcuts.preset, "default");
  assert.deepEqual(data.shortcuts.custom, {});
});

test("the saved presets are the ones RT-14 offers on its preset keys", async () => {
  const { data } = await getMySettings();
  const rt14 = scenarioReview.taskDisplay["RT-14"]?.presets.map((preset) => preset.name);
  assert.deepEqual(data.personal.presets, rt14);
});

test("two other devices are signed in until they are signed out", async () => {
  const before = await listSessions();
  assert.equal(before.status, 200);
  if (before.status !== 200) return;
  assert.deepEqual(
    before.data.filter((session) => !session.current).map((session) => session.user_agent),
    ["Windows workstation in room 214", "iPad"],
  );
  const ended = await endOtherSessions();
  assert.equal(ended.status, 200);
  if (ended.status === 200) assert.equal(ended.data.ended, 2);
  const afterwards = await listSessions();
  if (afterwards.status === 200) assert.equal(afterwards.data.length, 1);
});

test("the lab locks the screen after 15 minutes", async () => {
  const policy = await getSessionPolicy();
  assert.equal(policy.status, 200);
  if (policy.status === 200) assert.equal(policy.data.idle_lock_minutes, 15);
});

test("notification preferences read email, bell or quiet per kind", async () => {
  const preferences = await listNotificationPreferences();
  assert.equal(preferences.status, 200);
  if (preferences.status !== 200) return;
  const assigned = preferences.data.find((item) => item.kind === "task-assigned");
  const mention = preferences.data.find((item) => item.kind === "mention");
  assert.deepEqual([assigned?.email, assigned?.in_app], [true, true]);
  assert.deepEqual([mention?.email, mention?.in_app], [false, true]);
});

test("the workspace keeps its defaults and locks, and refuses a lock without a value", async () => {
  const saved = await setWorkspaceSettings({
    values: { default_privacy_mode: "clinical", default_classes: "pannuke" },
    locked: ["default_privacy_mode"],
  });
  assert.equal(saved.status, 200);
  const layers = await getMySettingLayers();
  if (layers.status !== 200) throw new Error("no layers");
  assert.deepEqual(layers.data.lab.values, {
    default_privacy_mode: "clinical",
    default_classes: "pannuke",
  });
  assert.deepEqual(layers.data.lab.locked, ["default_privacy_mode"]);
  await assert.rejects(setWorkspaceSettings({ values: {}, locked: ["default_study_template"] }), {
    status: 400,
  });
  await assert.rejects(setWorkspaceSettings({ values: { lock_after_minutes: 9000 } }), {
    status: 400,
  });
});

test("lock times, tiers and announcements change on save and come back on reset", async () => {
  const policy = await updateSessionPolicy({
    idle_lock_minutes: 30,
    session_hours: 10,
    emergency_hours: 4,
  });
  assert.equal(policy.status, 200);
  const read = await getSessionPolicy();
  if (read.status === 200) assert.equal(read.data.idle_lock_minutes, 30);
  const tier = await setModelTier("tumor", "good", { name: "camelyon-tumor" });
  assert.equal(tier.status, 200);
  await assert.rejects(setModelTier("tumor", "fast", { name: "hovernet" }), { status: 409 });
  const tiers = await listModelTiers();
  if (tiers.status === 200) {
    const good = tiers.data.find((item) => item.task === "tumor" && item.tier === "good");
    assert.deepEqual([good?.model?.name, good?.set_by_lab], ["camelyon-tumor", true]);
  }
  await resetModelTier("tumor", "good");
  const after = await listModelTiers();
  if (after.status === 200) {
    assert.equal(
      after.data.find((item) => item.task === "tumor" && item.tier === "good")?.model,
      null,
    );
  }
  const posted = await createAnnouncement({ kind: "change", text: "Rounds move to 09:00" });
  assert.equal(posted.status, 201);
  if (posted.status !== 201) return;
  const listed = await listAnnouncements();
  if (listed.status === 200) assert.equal(listed.data[0]?.text, "Rounds move to 09:00");
  await endAnnouncement(posted.data.id);
  const remaining = await listAnnouncements();
  if (remaining.status === 200) {
    assert.equal(
      remaining.data.some((item) => item.id === posted.data.id),
      false,
    );
  }
});
