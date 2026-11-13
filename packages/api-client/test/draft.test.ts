import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as draft from "../src/draft/index.ts";
import { draftOperations } from "../src/fake/index.ts";
import * as generatedMocks from "../src/generated/api.msw.ts";
import * as generated from "../src/generated/api.ts";

const draftFakeExports = Object.keys(await import("../src/fake/draft-handlers.ts"));
const generatedNames = new Set([...Object.keys(generated), ...Object.keys(generatedMocks)]);

const capitalised = (name: string) => `${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;

test("no draft export is also generated, so a draft is deleted when its route ships", () => {
  const clashes = [...Object.keys(draft), ...draftFakeExports].filter((name) =>
    generatedNames.has(name),
  );
  assert.deepEqual(clashes, []);
});

test("no draft operation's planned path is in openapi.json", async () => {
  const schema = JSON.parse(
    await readFile(new URL("../openapi.json", import.meta.url), "utf8"),
  ) as { paths: Record<string, Record<string, { operationId?: string }>> };
  const operationIds = new Set(
    Object.values(schema.paths).flatMap((item) => Object.values(item).map((op) => op.operationId)),
  );
  for (const operation of draftOperations) {
    assert.equal(schema.paths[operation.path]?.[operation.method], undefined, operation.path);
    assert.ok(!operationIds.has(operation.operationId), operation.operationId);
  }
});

test("each draft operation exports every name Orval would generate for it", () => {
  const exported = new Set([...Object.keys(draft), ...draftFakeExports]);
  for (const { operationId, method } of draftOperations) {
    const name = capitalised(operationId);
    const kind = method === "get" ? "Query" : "Mutation";
    for (const expected of [
      operationId,
      `use${name}`,
      `get${name}Url`,
      `get${name}${kind}Key`,
      `get${name}${kind}Options`,
      `get${name}MockHandler`,
    ]) {
      assert.ok(exported.has(expected), expected);
    }
  }
});

test("draft queries carry the draft marker the badge looks for", () => {
  const options = draft.getListTeamWorkloadQueryOptions();
  assert.ok(draft.isDraftMeta(options.meta));
  assert.deepEqual(options.meta, { draft: "listTeamWorkload" });
  assert.deepEqual(options.queryKey, ["/api/me/team"]);
});
