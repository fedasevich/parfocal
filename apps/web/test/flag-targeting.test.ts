import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { flagCatalogue } from "../src/flags/catalogue.ts";
import { bundledFlagDefinitions } from "../src/flags/flags.ts";
import { fetchPostHogArms, postHogFlagRequest, remoteArmsFrom } from "../src/flags/posthog.ts";
import {
  evaluateFlag,
  type FlagContext,
  type FlagDefinition,
  type FlagDefinitions,
  type FlagEvaluation,
  flagProblems,
  type RemoteArms,
} from "../src/flags/targeting.ts";

type Vectors = {
  definitions: FlagDefinitions;
  cases: { flag: string; context: FlagContext; remote: RemoteArms; expected: FlagEvaluation }[];
};

const vectors = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/py-common/tests/fixtures/flag-targeting-vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Vectors;

const arms = ["control", "status_board"];
const targeted: FlagDefinitions = {
  home: {
    arms,
    default: "control",
    mode: "split",
    rules: [
      { arm: "status_board", users: ["usr_pilot0001"] },
      { arm: "control", workspaces: ["wsp_holdout01"] },
      { arm: "status_board", workspaces: ["wsp_pilotlab1"], roles: ["reviewer"] },
    ],
  },
};

test("the shared vectors give the same arm and reason as the server", () => {
  assert.ok(vectors.cases.length > 50);
  for (const entry of vectors.cases) {
    assert.deepEqual(
      evaluateFlag(vectors.definitions, entry.flag, entry.context, entry.remote),
      entry.expected,
      JSON.stringify(entry),
    );
  }
});

test("a user rule wins over a workspace rule because rules are read in order", () => {
  const result = evaluateFlag(targeted, "home", {
    userId: "usr_pilot0001",
    workspaceId: "wsp_holdout01",
  });
  assert.deepEqual(result, { arm: "status_board", reason: "rule" });
});

test("a workspace rule holds every member of that workspace in one arm", () => {
  for (let index = 0; index < 40; index += 1) {
    const userId = `usr_${index.toString(36).padStart(8, "0")}x`;
    const result = evaluateFlag(targeted, "home", { userId, workspaceId: "wsp_holdout01" });
    assert.deepEqual(result, { arm: "control", reason: "rule" });
  }
});

test("a rule with a workspace and a role needs both", () => {
  const userId = "usr_00000042x";
  const both = evaluateFlag(targeted, "home", {
    userId,
    workspaceId: "wsp_pilotlab1",
    roles: ["researcher", "reviewer"],
  });
  assert.deepEqual(both, { arm: "status_board", reason: "rule" });
  const roleOnly = evaluateFlag(targeted, "home", { userId, roles: ["reviewer"] });
  assert.equal(roleOnly.reason, "split");
  const workspaceOnly = evaluateFlag(targeted, "home", {
    userId,
    workspaceId: "wsp_pilotlab1",
    roles: ["researcher"],
  });
  assert.equal(workspaceOnly.reason, "split");
});

test("the kill switch beats rules and remote arms", () => {
  const killed: FlagDefinitions = { home: { ...(targeted.home as FlagDefinition), killed: true } };
  const result = evaluateFlag(
    killed,
    "home",
    { userId: "usr_pilot0001" },
    { home: "status_board" },
  );
  assert.deepEqual(result, { arm: "control", reason: "killed" });
});

test("a remote arm beats local rules and a remote off returns the default", () => {
  const context = { userId: "usr_00000042x", workspaceId: "wsp_holdout01" };
  assert.deepEqual(evaluateFlag(targeted, "home", context, { home: "status_board" }), {
    arm: "status_board",
    reason: "remote",
  });
  assert.deepEqual(evaluateFlag(targeted, "home", { userId: "usr_pilot0001" }, { home: false }), {
    arm: "control",
    reason: "remote_off",
  });
  assert.equal(evaluateFlag(targeted, "home", context, { home: "unknown_arm" }).reason, "rule");
});

test("the bundled flag file is valid and matches the typed catalogue", () => {
  assert.deepEqual(flagProblems(bundledFlagDefinitions), []);
  assert.deepEqual(Object.keys(bundledFlagDefinitions).sort(), Object.keys(flagCatalogue).sort());
  for (const [key, catalogueArms] of Object.entries(flagCatalogue)) {
    assert.deepEqual(bundledFlagDefinitions[key]?.arms, catalogueArms);
  }
});

test("flag problems name a bad default, an unknown rule arm, an empty rule and a non id", () => {
  const problems = flagProblems({
    home: {
      arms,
      default: "other",
      mode: "split",
      rules: [
        { arm: "other", users: ["usr_00000042x"] },
        { arm: "control" },
        { arm: "control", users: ["a@b.org"] },
      ],
    },
  });
  assert.equal(problems.length, 4);
});

test("the PostHog request carries only pseudonymous ids and role names", () => {
  const body = postHogFlagRequest("phc_test", {
    userId: "usr_00000042x",
    workspaceId: "wsp_pilotlab1",
    roles: ["reviewer", "researcher"],
  });
  assert.deepEqual(body, {
    api_key: "phc_test",
    distinct_id: "usr_00000042x",
    groups: { workspace: "wsp_pilotlab1" },
    person_properties: { roles: "researcher,reviewer" },
    group_properties: {},
  });
  assert.throws(() => postHogFlagRequest("phc_test", { userId: "jane.doe@example.org" }));
});

test("PostHog answers become remote arms and unknown values are dropped", () => {
  const remote = remoteArmsFrom(
    {
      flags: {
        lab_lead_default_home: { enabled: true, variant: "status_board" },
        not_ours: { enabled: true, variant: "x" },
      },
    },
    bundledFlagDefinitions,
  );
  assert.deepEqual(remote, { lab_lead_default_home: "status_board" });
  assert.deepEqual(
    remoteArmsFrom(
      { flags: { lab_lead_default_home: { enabled: false } } },
      bundledFlagDefinitions,
    ),
    { lab_lead_default_home: false },
  );
  assert.deepEqual(
    remoteArmsFrom(
      { flags: { lab_lead_default_home: { enabled: true, variant: "made_up" } } },
      bundledFlagDefinitions,
    ),
    {},
  );
  assert.deepEqual(remoteArmsFrom(null, bundledFlagDefinitions), {});
});

test("fetching PostHog arms posts once and falls back to nothing on failure", async () => {
  const calls: { url: string; body: string }[] = [];
  const fake = ((url: string, init: RequestInit) => {
    calls.push({ url, body: typeof init.body === "string" ? init.body : "" });
    return Promise.resolve(
      Response.json({ flags: { lab_lead_default_home: { enabled: true, variant: "control" } } }),
    );
  }) as typeof fetch;
  const context = { userId: "usr_00000042x" };
  const config = { host: "https://posthog.test/", projectKey: "phc_test", fetch: fake };
  assert.deepEqual(await fetchPostHogArms(config, context, bundledFlagDefinitions), {
    lab_lead_default_home: "control",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://posthog.test/flags/?v=2");
  const sentBody = JSON.parse(calls[0]?.body ?? "{}") as { distinct_id?: string };
  assert.equal(sentBody.distinct_id, "usr_00000042x");
  const failing = (() => Promise.resolve(new Response("", { status: 500 }))) as typeof fetch;
  const throwing = (() => Promise.reject(new Error("offline"))) as typeof fetch;
  for (const broken of [failing, throwing]) {
    assert.deepEqual(
      await fetchPostHogArms({ ...config, fetch: broken }, context, bundledFlagDefinitions),
      {},
    );
  }
});
