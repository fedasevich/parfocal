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
  getMyAvailability,
  getMySettingLayers,
  getSessionPolicy,
  listAnnouncements,
  listModelTiers,
  listNotificationPreferences,
  listSessions,
  resetModelTier,
  resolveSettings,
  setModelTier,
  setMyAvailability,
  setMySettingLayers,
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

const personalLayer = async () => {
  const layers = await getMySettingLayers();
  if (layers.status !== 200) throw new Error("no layers");
  return layers.data;
};

test("the seeded personal layer resolves to the screen's defaults", async () => {
  const values = resolveSettings({ ...(await personalLayer()), device: {} });
  assert.equal(values.default_preset, 0);
  assert.equal(values.shortcut_preset, "default");
  assert.deepEqual(values.shortcut_custom, {});
  assert.equal(values.side_panel_width, 340);
  assert.equal(values.language, "en");
});

test("the saved presets are the ones RT-14 offers on its preset keys", async () => {
  const rt14 = scenarioReview.taskDisplay["RT-14"]?.presets.map((preset) => preset.name);
  assert.deepEqual((await personalLayer()).personal["presets"], rt14);
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
  await assert.rejects(setWorkspaceSettings({ values: { decision_cutoff: 9000 } }), {
    status: 400,
  });
});

test("a personal setting is kept, cleared with null and refused when unknown", async () => {
  const seeded = await getMySettingLayers();
  if (seeded.status !== 200) throw new Error("no layers");
  assert.equal(seeded.data.personal["home_layout"], "both");
  const saved = await setMySettingLayers({ values: { home_layout: "research" } });
  if (saved.status !== 200) throw new Error("not saved");
  assert.equal(saved.data.personal["home_layout"], "research");
  const layers = await getMySettingLayers();
  if (layers.status !== 200) throw new Error("no layers");
  assert.equal(layers.data.personal["home_layout"], "research");
  const cleared = await setMySettingLayers({ values: { home_layout: null } });
  if (cleared.status !== 200) throw new Error("not cleared");
  assert.equal(cleared.data.personal["home_layout"], undefined);
  await assert.rejects(setMySettingLayers({ values: { home_layout: "anywhere" } }), {
    status: 400,
  });
  await assert.rejects(setMySettingLayers({ values: { decision_cutoff: 10 } }), { status: 400 });
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

test("my availability starts available and keeps an away status with its note", async () => {
  assert.equal((await getMyAvailability()).data.status, "available");
  await setMyAvailability({ status: "away", until: "2099-11-04T15:00:00+01:00", note: "Course" });
  const away = await getMyAvailability();
  assert.equal(away.status, 200);
  if (away.status === 200) assert.deepEqual([away.data.status, away.data.note], ["away", "Course"]);
  await setMyAvailability({ status: "available" });
  const back = await getMyAvailability();
  assert.equal(back.status, 200);
  if (back.status === 200) {
    assert.deepEqual(
      [back.data.status, back.data.until, back.data.note],
      ["available", null, null],
    );
  }
});

test("available with a note or a past end is refused like the API", async () => {
  await assert.rejects(setMyAvailability({ status: "available", note: "x" }), { status: 400 });
  await assert.rejects(setMyAvailability({ status: "away", until: "2020-01-01T00:00:00Z" }), {
    status: 400,
  });
  assert.equal((await getMyAvailability()).data.status, "available");
});

test("saved shortcuts come back from the personal layer until the fake is reset", async () => {
  await setMySettingLayers({
    values: {
      shortcut_preset: "qupath",
      shortcut_custom: { dnext: ["W"] },
      shortcut_single_letter: false,
      shortcut_whole_slide_key: "tap",
    },
  });
  const values = resolveSettings({ ...(await personalLayer()), device: {} });
  assert.equal(values.shortcut_preset, "qupath");
  assert.deepEqual(values.shortcut_custom, { dnext: ["W"] });
  assert.equal(values.shortcut_single_letter, false);
  assert.equal(values.shortcut_by_position, true);
  assert.equal(values.shortcut_whole_slide_key, "tap");
  resetConsoleActions();
  assert.equal((await personalLayer()).personal["shortcut_custom"], undefined);
});

test("shortcuts with an unknown whole slide mode or a bare key are refused", async () => {
  await assert.rejects(setMySettingLayers({ values: { shortcut_whole_slide_key: "double" } }), {
    status: 400,
  });
  await assert.rejects(setMySettingLayers({ values: { shortcut_custom: { dnext: "W" } } }), {
    status: 400,
  });
});
