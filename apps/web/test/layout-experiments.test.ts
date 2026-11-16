import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  defaultArm,
  experimentCache,
  experimentsLive,
  flagContextFor,
} from "../src/flags/app-experiments.ts";
import { flagCatalogue } from "../src/flags/catalogue.ts";
import { bundledFlagDefinitions, localFlagService } from "../src/flags/flags.ts";
import { pinnedMinimap, placeMinimap } from "../src/screens/viewer-tools/minimap-placement.ts";
import { chooseToolsLayout } from "../src/shell/tools-layout-choice.ts";
import { areas, type EventSink, eventSchema, taskKinds } from "../src/telemetry/events.ts";

const layoutFlags = ["viewer_tools_layout", "minimap_motion"] as const;

const query = readFileSync(
  new URL("../analytics/layout-experiments.hogql", import.meta.url),
  "utf8",
);

test("both layout experiments split users and default to today's layout", () => {
  for (const flag of layoutFlags) {
    const definition = bundledFlagDefinitions[flag];
    assert.equal(definition?.mode, "split");
    assert.deepEqual(definition?.arms, flagCatalogue[flag]);
  }
  assert.equal(defaultArm("viewer_tools_layout"), "rail");
  assert.equal(defaultArm("minimap_motion"), "moving");
});

test("a tools layout the user chose beats the experiment arm", () => {
  assert.equal(chooseToolsLayout(undefined, "dock"), "dock");
  assert.equal(chooseToolsLayout({ value: "rail", source: "default" }, "dock"), "dock");
  assert.equal(chooseToolsLayout({ value: "rail", source: "personal" }, "dock"), "rail");
  assert.equal(chooseToolsLayout({ value: "dock", source: "personal" }, "rail"), "dock");
});

test("a pinned minimap stays bottom right whatever is under it", () => {
  const canvas = { width: 1200, height: 800 };
  const box = { width: 200, height: 140 };
  const crowded = placeMinimap(canvas, box, [[1100, 720, 50]], [[900, 600, 300, 200]]);
  assert.notEqual(crowded.corner, "bottom-right");
  const pinned = pinnedMinimap(canvas, box);
  assert.equal(pinned.corner, "bottom-right");
  assert.equal(pinned.x, 1200 - 200 - 12);
  assert.equal(pinned.y, 800 - 140 - 12);
});

test("both layout experiments ship switched off until the owner starts them", () => {
  for (const flag of layoutFlags) assert.equal(bundledFlagDefinitions[flag]?.killed, true);
  const sent: unknown[] = [];
  const cache = experimentCache(localFlagService(), { track: () => sent.push(1) });
  const context = { userId: "usr_00000042x", workspaceId: "wsp_00000007x" };
  assert.equal(cache.for(context).arm("viewer_tools_layout"), "rail");
  assert.equal(cache.for(context).arm("minimap_motion"), "moving");
  assert.equal(sent.length, 0);
});

test("each user is exposed once per flag with ids only", () => {
  const sent: { name: string; properties: Record<string, unknown> }[] = [];
  const sink: EventSink = { track: (name, properties) => sent.push({ name, properties }) };
  const started = Object.fromEntries(
    Object.entries(bundledFlagDefinitions).map(([key, definition]) => [
      key,
      { ...definition, killed: false },
    ]),
  );
  const cache = experimentCache(localFlagService(started), sink);
  const context = { userId: "usr_00000042x", workspaceId: "wsp_00000007x" };
  for (let round = 0; round < 3; round += 1) {
    for (const flag of layoutFlags) cache.for(context).arm(flag);
  }
  assert.equal(sent.length, 2);
  for (const event of sent) {
    assert.equal(event.name, "experiment_exposed");
    assert.deepEqual(Object.keys(event.properties).sort(), ["arm", "flag"]);
  }
});

test("experiments run only in production against the real API", () => {
  assert.equal(experimentsLive({ appEnv: "prod", fakeApi: "off" }), true);
  assert.equal(experimentsLive({ appEnv: "prod", fakeApi: "all" }), false);
  assert.equal(experimentsLive({ appEnv: "dev", fakeApi: "off" }), false);
});

test("a person without pseudonymous ids gets the default arm instead of an error", () => {
  assert.equal(flagContextFor({ user_id: "u1", active_tenant_id: null }), undefined);
  assert.deepEqual(flagContextFor({ user_id: "usr_00000042x", active_tenant_id: "Holloway Lab" }), {
    userId: "usr_00000042x",
  });
  assert.deepEqual(
    flagContextFor({ user_id: "usr_00000042x", active_tenant_id: "wsp_00000007x" }),
    {
      userId: "usr_00000042x",
      workspaceId: "wsp_00000007x",
    },
  );
});

const literals = (text: string) => [...text.matchAll(/'([^']*)'/gu)].map((match) => match[1] ?? "");

test("the analysis query is balanced and has one statement", () => {
  let depth = 0;
  for (const character of query.replace(/'[^']*'/gu, "''")) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    assert.ok(depth >= 0);
  }
  assert.equal(depth, 0);
  assert.equal((query.match(/'/gu) ?? []).length % 2, 0);
  assert.ok(!query.includes(";"));
  assert.match(query.trimStart(), /^WITH\b/u);
  assert.match(query, /\bSELECT\b[\s\S]*\bFROM events\b/u);
});

test("the analysis query names only events, properties and values that exist", () => {
  const eventNames = new Set<string>();
  for (const match of query.matchAll(/event\s*=\s*'([a-z_]+)'/gu)) eventNames.add(match[1] ?? "");
  for (const match of query.matchAll(/event IN \(([^)]*)\)/gu)) {
    for (const name of literals(match[1] ?? "")) eventNames.add(name);
  }
  assert.ok(eventNames.size >= 6);
  for (const name of eventNames) assert.ok(name in eventSchema, `unknown event ${name}`);

  const known = new Set(
    [...eventNames].flatMap((name) => Object.keys(eventSchema[name as keyof typeof eventSchema])),
  );
  for (const match of query.matchAll(/properties\.([a-z_]+)/gu)) {
    assert.ok(known.has(match[1] ?? ""), `unknown property ${match[1]}`);
  }

  for (const match of query.matchAll(/properties\.flag IN \(([^)]*)\)/gu)) {
    assert.deepEqual(literals(match[1] ?? "").sort(), [...layoutFlags].sort());
  }
  for (const match of query.matchAll(/task_kind = '([a-z_]+)'/gu)) {
    assert.ok(taskKinds.includes(match[1] ?? ""));
  }
  for (const match of query.matchAll(/area = '([a-z_]+)'/gu)) {
    assert.ok(areas.includes(match[1] ?? ""));
  }
  assert.ok(!/case_id|slide_id|email|name/u.test(query));
});
