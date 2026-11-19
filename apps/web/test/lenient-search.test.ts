import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import type { z } from "zod";
import * as routeSearches from "../src/search/route-searches.ts";
import { overlaySearch } from "../src/shell/overlays.ts";

type Lenient = { shape: Record<string, z.ZodType>; read: (input: never) => unknown };

const searches: [string, Lenient][] = [
  ["overlaySearch", overlaySearch],
  ...Object.entries(routeSearches).flatMap(([name, value]): [string, Lenient][] =>
    typeof value === "object" && "shape" in value ? [[name, value]] : [],
  ),
];

test("every route search schema is covered", () => {
  assert.ok(searches.length >= 31, `only ${searches.length} schemas found`);
});

test("an unknown or malformed value for any key falls back to what the key is without it", () => {
  const unknownValues: unknown[] = ["zz-unknown", { nested: true }, -5, true, ["a"], null];
  for (const [name, search] of searches) {
    const fallback = search.read({} as never) as Record<string, unknown>;
    for (const key of Object.keys(search.shape)) {
      for (const value of unknownValues) {
        const shape = search.shape[key] as z.ZodType;
        if (shape.safeParse(value).success) continue;
        const parsed = search.read({ [key]: value } as never) as Record<string, unknown>;
        assert.deepEqual(
          parsed[key],
          fallback[key],
          `${name}.${key} with ${JSON.stringify(value)}`,
        );
      }
    }
  }
});

test("a good value survives next to a bad one", () => {
  const parsed = routeSearches.projectSearch.read({ tab: "nope", q: "kidney" });
  assert.deepEqual(parsed, { tab: "slides", q: "kidney" });
  assert.equal(routeSearches.projectSearch.read({ tab: "tasks" }).tab, "tasks");
});

test("the project tab falls back to slides for an unknown tab", () => {
  assert.equal(routeSearches.projectSearch.read({ tab: "review-tasks" }).tab, "slides");
});

test("the router's standard validator path falls back too", () => {
  const result = routeSearches.projectSearch["~standard"].validate({ tab: "review-tasks" });
  assert.deepEqual(result, { value: { tab: "slides" } });
});

test("the invite search has no demo token", () => {
  assert.equal(routeSearches.inviteSearch.read({}).token, undefined);
  assert.equal(routeSearches.inviteSearch.read({ token: "" }).token, undefined);
  assert.equal(routeSearches.inviteSearch.read({ token: "abc" }).token, "abc");
});

test("no route builds its own strict search schema", () => {
  const dir = new URL("../src/routes/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".tsx"))) {
    assert.ok(!readFileSync(new URL(file, dir), "utf8").includes("z.object("), file);
  }
});
