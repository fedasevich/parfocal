import { isDraftMeta } from "@parfocal/api-client";
import type { Query, QueryCache } from "@tanstack/react-query";
import type { FakeApiMode } from "../config.ts";

export type FakeScope = Exclude<FakeApiMode, "off">;

type QueryLike = Pick<Query, "meta" | "isActive">;

export function activeDraftOperations(queries: readonly QueryLike[]): string[] {
  const operations = queries
    .filter((query) => query.isActive() && isDraftMeta(query.meta))
    .map((query) => (isDraftMeta(query.meta) ? query.meta.draft : ""));
  return [...new Set(operations)].sort();
}

export function fakeBadgeLabel(scope: FakeScope, queries: readonly QueryLike[]): string | null {
  if (scope === "all") return "Fake data";
  const drafts = activeDraftOperations(queries);
  return drafts.length > 0 ? `Fake data from drafts: ${drafts.join(", ")}` : null;
}

export function subscribeToQueries(cache: QueryCache, onChange: () => void): () => void {
  return cache.subscribe(onChange);
}
