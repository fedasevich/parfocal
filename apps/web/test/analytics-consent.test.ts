import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyticsOptedOut,
  consentedAnalytics,
  setAnalyticsOptOut,
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

test("analytics are on until the user opts out and the choice is kept", () => {
  const storage = memory();
  assert.equal(analyticsOptedOut(storage), false);
  assert.equal(setAnalyticsOptOut(true, storage), true);
  assert.equal(analyticsOptedOut(storage), true);
  setAnalyticsOptOut(false, storage);
  assert.equal(analyticsOptedOut(storage), false);
});

test("the choice sits beside the other device settings", () => {
  const storage = memory();
  storage.setItem("parfocal.device-settings", JSON.stringify({ theme: "dark" }));
  setAnalyticsOptOut(true, storage);
  assert.deepEqual(JSON.parse(storage.getItem("parfocal.device-settings") ?? ""), {
    theme: "dark",
    analytics_opt_out: true,
  });
});

test("no event is sent after opt-out, and sending resumes after opting back in", () => {
  const storage = memory();
  const seen: string[] = [];
  const optedOut = () => analyticsOptedOut(storage);
  const client = consentedAnalytics({ capture: (event) => void seen.push(event) }, optedOut);
  const sink = eventSink(client, optedOut);
  sink.track("task_started", started);
  setAnalyticsOptOut(true, storage);
  sink.track("task_started", started);
  sink.track("task_finished", { ...started, duration_ms: 5 });
  assert.deepEqual(seen, ["task_started"]);
  setAnalyticsOptOut(false, storage);
  sink.track("task_started", started);
  assert.deepEqual(seen, ["task_started", "task_started"]);
});

test("the analytics client alone drops events after opt-out", () => {
  const storage = memory();
  const seen: string[] = [];
  const client = consentedAnalytics({ capture: (event) => void seen.push(event) }, () =>
    analyticsOptedOut(storage),
  );
  setAnalyticsOptOut(true, storage);
  client.capture("anything", {});
  assert.deepEqual(seen, []);
});
