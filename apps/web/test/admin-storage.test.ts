import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServiceAccount, StorageSource, StorageUsage } from "@parfocal/api-client";
import {
  barTotalTb,
  fullness,
  projectShare,
  sizeText,
  sourceState,
  spaceParts,
} from "../src/screens/admin/storage-model.ts";
import { liveTokens, scopeNames, tokenDraftError } from "../src/screens/admin/tokens-model.ts";

const usage = (parts: [string, number][], capacityTb: number | null): StorageUsage => {
  const total = parts.reduce((sum, [, bytes]) => sum + bytes, 0);
  return {
    total_tb: total / 1e12,
    total_bytes: total,
    capacity_tb: capacityTb,
    in_place_tb: 0,
    in_place_bytes: 0,
    parts: parts.map(([kind, bytes]) => ({ kind, label: kind, tb: bytes / 1e12, bytes })),
    by_project: [],
    rules: [],
    sources: [],
  };
};

test("an empty workspace draws an empty bar with no share and no warning", () => {
  const empty = usage([["copied-slides", 0]], null);
  assert.equal(fullness(empty), "empty");
  assert.equal(barTotalTb(empty), null);
  assert.deepEqual(
    spaceParts(empty).map((part) => part.tb),
    [0],
  );
  assert.equal(projectShare(0, empty), 0);
  assert.equal(sizeText(empty.total_bytes), "0 GB");
});

test("a nearly full workspace warns and measures the bar against its capacity", () => {
  const nearly = usage(
    [
      ["copied-slides", 3.9e12],
      ["tile-cache", 0.4e12],
      ["results", 0.3e12],
    ],
    5,
  );
  assert.equal(fullness(nearly), "nearly-full");
  assert.equal(barTotalTb(nearly), 5);
  assert.equal(
    spaceParts(nearly)
      .reduce((sum, part) => sum + part.tb, 0)
      .toFixed(1),
    "4.6",
  );
  assert.equal(fullness(usage([["copied-slides", 5e12]], 5)), "full");
  assert.equal(fullness(usage([["copied-slides", 1e12]], 5)), "roomy");
  assert.equal(fullness(usage([["copied-slides", 1e12]], null)), "roomy");
});

test("the bar is measured against the 1 TB workspace capacity", () => {
  const roomy = usage([["copied-slides", 0.4e12]], 1);
  assert.equal(barTotalTb(roomy), 1);
  assert.equal(fullness(roomy), "roomy");
  assert.equal(fullness(usage([["copied-slides", 0.95e12]], 1)), "nearly-full");
  assert.equal(fullness(usage([["copied-slides", 1e12]], 1)), "full");
});

test("each kind keeps its own storage colour and none is the tumor red", () => {
  const parts = spaceParts(
    usage(
      [
        ["copied-slides", 1],
        ["tile-cache", 1],
        ["results", 1],
      ],
      null,
    ),
  );
  assert.deepEqual(
    parts.map((part) => part.colour),
    ["var(--st-1)", "var(--st-2)", "var(--st-3)"],
  );
});

test("project shares stay within the bar and sizes read in the nearest unit", () => {
  const some = usage([["copied-slides", 2e9]], null);
  assert.equal(projectShare(1e9, some), 50);
  assert.equal(projectShare(4e9, some), 100);
  assert.equal(sizeText(1.5e12), "1.5 TB");
  assert.equal(sizeText(7e9), "7 GB");
  assert.equal(sizeText(25e6), "25 MB");
  assert.equal(sizeText(512), "Under 1 MB");
});

const source = (change: Partial<StorageSource>): StorageSource => ({
  id: "s",
  name: "Archive",
  kind: "https",
  access: "No key",
  address: "https://archive.example/",
  new_slides: "in-place",
  health: "answering",
  first_tile_ms: null,
  expires_in_days: null,
  slides_in_place: 4,
  last_read_at: null,
  ...change,
});

test("a source names its state from the slides read through it", () => {
  assert.deepEqual(sourceState(source({})), { tone: "ok", text: "Answering · 4 slides" });
  assert.deepEqual(sourceState(source({ health: "unreachable" })), {
    tone: "warn",
    text: "Not answering",
  });
  assert.equal(sourceState(source({ health: "unused", slides_in_place: 0 })).tone, "neutral");
  assert.equal(
    sourceState(source({ health: "expiring", expires_in_days: 3 })).text,
    "Key expires in 3 days",
  );
});

const account = (tokens: ServiceAccount["tokens"], disabled: string | null = null) => ({
  id: "a",
  name: "Add result sets",
  scopes: ["upload-slides", "see-slides"] as ServiceAccount["scopes"],
  disabled_at: disabled,
  created_at: "2026-10-01T00:00:00Z",
  tokens,
});

const token = (id: string, change: Partial<ServiceAccount["tokens"][number]> = {}) => ({
  id,
  created_at: "2026-10-01T00:00:00Z",
  expires_at: "2027-01-01T00:00:00Z",
  revoked_at: null,
  last_used_at: null,
  ...change,
});

test("only tokens that still work are listed", () => {
  const at = new Date("2026-10-15T12:00:00Z");
  const rows = liveTokens(
    [
      account([
        token("live"),
        token("revoked", { revoked_at: "2026-10-10T00:00:00Z" }),
        token("expired", { expires_at: "2026-10-01T00:00:00Z" }),
      ]),
      { ...account([token("off")], "2026-10-02T00:00:00Z"), id: "b" },
    ],
    at,
  );
  assert.deepEqual(
    rows.map((row) => row.token.id),
    ["live"],
  );
  assert.equal(
    scopeNames(["upload-slides", "see-slides"]),
    "See slides, Upload slides and results",
  );
});

test("a new token needs a name and something it can do", () => {
  assert.equal(tokenDraftError(" ", ["see-slides"]), "Name the pipeline that uses the token");
  assert.equal(tokenDraftError("Lab", []), "Pick at least one thing the token can do");
  assert.equal(tokenDraftError("Lab", ["see-slides"]), null);
});
