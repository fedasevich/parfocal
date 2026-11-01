import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, resetSettingsActions, scenarioReview } from "../src/fake/index.ts";
import {
  endOtherSessions,
  getGetMySettingsQueryOptions,
  getMySettings,
  getSessionPolicy,
  isDraftMeta,
  listNotificationPreferences,
  listSessions,
} from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => resetSettingsActions());

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
