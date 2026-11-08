import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AnalyticsChoices,
  analyticsAllowed,
  analyticsOptedOut,
  consentedAnalytics,
  rememberAnalyticsChoices,
} from "../src/telemetry/consent.ts";
import { eventSink } from "../src/telemetry/events.ts";

const memory = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
};

const started = { task_kind: "review", case_id: "case-00001" } as const;

const choices = (
  analytics_policy: AnalyticsChoices["analytics_policy"],
  analytics_opt_out: boolean,
): AnalyticsChoices => ({ analytics_policy, analytics_opt_out });

test("the workspace policy wins over what the person chose", () => {
  assert.equal(analyticsAllowed(choices("person", false)), true);
  assert.equal(analyticsAllowed(choices("person", true)), false);
  assert.equal(analyticsAllowed(choices("off", false)), false);
  assert.equal(analyticsAllowed(choices("on", true)), true);
});

test("nothing is sent before the workspace policy is known on this device", () => {
  assert.equal(analyticsOptedOut(memory()), true);
});

test("the remembered choices sit beside the other device settings", () => {
  const storage = memory();
  storage.setItem("parfocal.device-settings", JSON.stringify({ theme: "dark" }));
  rememberAnalyticsChoices(choices("person", true), storage);
  assert.deepEqual(JSON.parse(storage.getItem("parfocal.device-settings") ?? ""), {
    theme: "dark",
    analytics_policy: "person",
    analytics_opt_out: true,
  });
});

test("no event is sent when the workspace turns analytics off whatever the person chose", () => {
  const storage = memory();
  const seen: string[] = [];
  const optedOut = () => analyticsOptedOut(storage);
  const client = consentedAnalytics({ capture: (event) => void seen.push(event) }, optedOut);
  const sink = eventSink(client, optedOut);
  rememberAnalyticsChoices(choices("person", false), storage);
  sink.track("task_started", started);
  rememberAnalyticsChoices(choices("off", false), storage);
  sink.track("task_started", started);
  client.capture("anything", {});
  assert.deepEqual(seen, ["task_started"]);
  rememberAnalyticsChoices(choices("person", false), storage);
  sink.track("task_started", started);
  assert.deepEqual(seen, ["task_started", "task_started"]);
});

test("a person's opt-out holds on a second device that loads the same personal layer", () => {
  const secondDevice = memory();
  assert.equal(analyticsOptedOut(secondDevice), true);
  rememberAnalyticsChoices(choices("person", true), secondDevice);
  const seen: string[] = [];
  const client = consentedAnalytics({ capture: (event) => void seen.push(event) }, () =>
    analyticsOptedOut(secondDevice),
  );
  client.capture("anything", {});
  assert.deepEqual(seen, []);
});

test("a workspace that turns analytics on overrides a person's opt-out", () => {
  const storage = memory();
  rememberAnalyticsChoices(choices("on", true), storage);
  assert.equal(analyticsOptedOut(storage), false);
});
