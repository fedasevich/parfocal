import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type ProvenanceObject,
  type ProvenanceVersion,
  provenanceOf,
} from "../src/annotations/provenance.ts";

const anna = { initials: "AK", name: "Anna Kopecká", color: "#38bdf8" };
const simona = { initials: "SM", name: "Simona Marková", color: "#f472b6" };
const people = new Map([
  ["u-anna", anna],
  ["u-simona", simona],
]);
const personOf = (id: string) => people.get(id);
const clock = (iso: string) => iso.slice(11, 16);
const model = { name: "CAMELYON", version: "v1.0", madeAt: "2026-11-04T09:58:00Z" };

const object = (patch: Partial<ProvenanceObject>): ProvenanceObject => ({
  id: "a1",
  code: "T5",
  origin: "human",
  created_by_user_id: "u-anna",
  changed_by_user_id: "u-anna",
  deleted_at: null,
  ...patch,
});

const version = (patch: Partial<ProvenanceVersion>): ProvenanceVersion => ({
  version: 1,
  change: "created",
  class_id: "tumor",
  changed_by_user_id: "u-anna",
  changed_at: "2026-11-04T10:41:00Z",
  ...patch,
});

describe("provenance of a shape", () => {
  test("an AI shape nobody touched shows the model name and version", () => {
    const result = provenanceOf({
      object: object({
        origin: "ai",
        created_by_user_id: null,
        changed_by_user_id: null,
      }),
      versions: [],
      model,
      personOf,
      clock,
    });
    assert.equal(result.origin, "ai");
    assert.equal(result.author, undefined);
    assert.deepEqual(result.model, { name: "CAMELYON", version: "v1.0" });
    assert.deepEqual(
      result.history.map((entry) => entry.what),
      ["Made by CAMELYON v1.0"],
    );
    assert.equal(result.history[0]?.when, "09:58");
  });

  test("an AI shape fixed by a named expert is AI edited and keeps the model", () => {
    const result = provenanceOf({
      object: object({ origin: "ai-edited", changed_by_user_id: "u-anna" }),
      versions: [
        version({ change: "edited", changed_by_user_id: "u-anna" }),
        version({
          version: 2,
          change: "edited",
          changed_by_user_id: "u-simona",
          changed_at: "2026-11-04T11:05:00Z",
        }),
      ],
      model,
      personOf,
      clock,
    });
    assert.equal(result.origin, "ai-edited");
    assert.equal(result.author?.name, "Anna Kopecká");
    assert.equal(result.model?.version, "v1.0");
    assert.deepEqual(
      result.history.map((entry) => [entry.who?.name ?? null, entry.what, entry.when]),
      [
        [null, "Made by CAMELYON v1.0", "09:58"],
        ["Anna Kopecká", "Fixed the AI object", "10:41"],
        ["Simona Marková", "Changed the outline", "11:05"],
      ],
    );
  });

  test("a shape drawn by a named expert shows no model and the later changes", () => {
    const result = provenanceOf({
      object: object({ changed_by_user_id: "u-simona" }),
      versions: [
        version({}),
        version({
          version: 2,
          change: "edited",
          class_id: "immune",
          changed_by_user_id: "u-simona",
          changed_at: "2026-11-04T12:00:00Z",
        }),
        version({
          version: 3,
          change: "deleted",
          changed_by_user_id: "u-simona",
          changed_at: "2026-11-04T12:30:00Z",
        }),
      ],
      model,
      personOf,
      clock,
    });
    assert.equal(result.origin, "human");
    assert.equal(result.model, undefined);
    assert.deepEqual(
      result.history.map((entry) => entry.what),
      ["Drew the shape", "Changed the class", "Deleted"],
    );
  });

  test("a version by someone who is not in the task has no person", () => {
    const result = provenanceOf({
      object: object({}),
      versions: [version({ changed_by_user_id: "u-gone" })],
      model: null,
      personOf,
      clock,
    });
    assert.equal(result.history[0]?.who, null);
  });
});
