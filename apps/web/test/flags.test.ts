import assert from "node:assert/strict";
import { test } from "node:test";
import { assignArm } from "../src/flags/assign.ts";
import {
  experimentsFor,
  type FlagDefinitions,
  type IdentifiedAnalytics,
  localFlagService,
  remoteFlagService,
} from "../src/flags/flags.ts";
import { flagArms, flagKeys } from "../src/telemetry/events.ts";

const flag = "lab_lead_default_home";
const arms = ["control", "status_board"];
const userIds = (count: number) =>
  Array.from({ length: count }, (_, index) => `usr_${index.toString(36).padStart(8, "0")}x`);

const recorder = () => {
  const sent: { distinctId: string; event: string; properties: Record<string, unknown> }[] = [];
  const target: IdentifiedAnalytics = {
    send: (distinctId, event, properties) => sent.push({ distinctId, event, properties }),
  };
  return { sent, target };
};

test("the same user always lands in the same arm", () => {
  const service = localFlagService();
  for (const id of userIds(200)) {
    const first = service.evaluate(flag, { userId: id });
    assert.deepEqual(first, service.evaluate(flag, { userId: id }));
    assert.equal(first.arm, assignArm(flag, id, arms));
  }
});

test("arms are balanced across 20000 users", () => {
  const counts = new Map<string, number>();
  for (const id of userIds(20000)) {
    const arm = assignArm(flag, id, arms);
    counts.set(arm, (counts.get(arm) ?? 0) + 1);
  }
  for (const arm of arms) {
    const share = (counts.get(arm) ?? 0) / 20000;
    assert.ok(Math.abs(share - 0.5) < 0.015, `${arm} share ${share}`);
  }
});

test("different flags split the same users independently", () => {
  let same = 0;
  const ids = userIds(10000);
  for (const id of ids) {
    if (assignArm("flag_one", id, arms) === assignArm("flag_two", id, arms)) same += 1;
  }
  assert.ok(Math.abs(same / ids.length - 0.5) < 0.03);
});

test("a default mode flag returns the default arm for everyone", () => {
  const definitions: FlagDefinitions = {
    [flag]: { arms, default: "control", mode: "default" },
  };
  const service = localFlagService(definitions);
  for (const id of userIds(50)) assert.equal(service.evaluate(flag, { userId: id }).arm, "control");
});

test("an unknown flag or a non pseudonymous id is refused", () => {
  const service = localFlagService();
  assert.throws(() => service.evaluate("nope", { userId: "usr_00000001x" }));
  assert.throws(() => service.evaluate(flag, { userId: "jane.doe@example.org" }));
  assert.throws(() =>
    service.evaluate(flag, { userId: "usr_00000001x", workspaceId: "Holloway Lab" }),
  );
});

test("the exposure event is sent once with only the flag and the arm", () => {
  const { sent, target } = recorder();
  const userId = "usr_00000042x";
  const session = experimentsFor(
    localFlagService(),
    { userId, workspaceId: "wsp_pilotlab1", roles: ["reviewer"] },
    target,
    () => false,
  );
  const first = session.arm(flag);
  session.arm(flag);
  assert.equal(sent.length, 1);
  const [event] = sent;
  assert.equal(event?.event, "experiment_exposed");
  assert.equal(event?.distinctId, userId);
  assert.deepEqual(event?.properties, { flag, arm: first });
  const text = JSON.stringify(event?.properties);
  assert.equal(text.includes(userId) || text.includes("wsp_pilotlab1"), false);
});

test("every exposure carries only listed flag and arm values", () => {
  for (const id of userIds(300)) {
    const { sent, target } = recorder();
    experimentsFor(localFlagService(), { userId: id }, target, () => false).arm(flag);
    const properties = sent[0]?.properties ?? {};
    assert.deepEqual(Object.keys(properties).sort(), ["arm", "flag"]);
    assert.ok(flagKeys.includes(properties.flag as never));
    assert.ok(flagArms.includes(properties.arm as string));
  }
});

test("a flag in default mode records no exposure", () => {
  const { sent, target } = recorder();
  const definitions: FlagDefinitions = { [flag]: { arms, default: "control", mode: "default" } };
  const session = experimentsFor(
    localFlagService(definitions),
    { userId: "usr_00000042x" },
    target,
    () => false,
  );
  assert.equal(session.arm(flag), "control");
  assert.equal(sent.length, 0);
});

test("targeted, killed and remotely switched off flags record no exposure", () => {
  const ruled: FlagDefinitions = {
    [flag]: {
      arms,
      default: "control",
      mode: "split",
      rules: [{ arm: "status_board", roles: ["reviewer"] }],
    },
  };
  const killed: FlagDefinitions = {
    [flag]: { arms, default: "control", mode: "split", killed: true },
  };
  const context = { userId: "usr_00000042x", roles: ["reviewer"] };
  for (const service of [
    localFlagService(ruled),
    localFlagService(killed),
    remoteFlagService({ [flag]: false }),
  ]) {
    const { sent, target } = recorder();
    experimentsFor(service, context, target, () => false).arm(flag);
    assert.equal(sent.length, 0);
  }
});

test("a remote arm is an assignment and records one exposure", () => {
  const { sent, target } = recorder();
  const session = experimentsFor(
    remoteFlagService({ [flag]: "status_board" }),
    { userId: "usr_00000042x" },
    target,
    () => false,
  );
  assert.equal(session.arm(flag), "status_board");
  assert.deepEqual(sent[0]?.properties, { flag, arm: "status_board" });
});

test("an opted out person produces no exposure", () => {
  const { sent, target } = recorder();
  experimentsFor(localFlagService(), { userId: "usr_00000042x" }, target, () => true).arm(flag);
  assert.equal(sent.length, 0);
});
