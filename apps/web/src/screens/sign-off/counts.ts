import type { SignOffSummary } from "@parfocal/api-client";

export type ResolvedPart =
  | { readonly kind: "you"; readonly count: number }
  | { readonly kind: "person"; readonly userId: string; readonly count: number }
  | { readonly kind: "left-open"; readonly count: number };

export function resolvedParts(
  queue: SignOffSummary["queue"],
  myUserId: string | undefined,
): ResolvedPart[] {
  const mine = queue.by_adjudicator
    .filter((row) => row.user_id === myUserId)
    .reduce((sum, row) => sum + row.count, 0);
  const parts: ResolvedPart[] = [];
  const byYou = queue.by_researcher + mine;
  if (byYou > 0) parts.push({ kind: "you", count: byYou });
  for (const row of queue.by_adjudicator) {
    if (row.user_id !== myUserId && row.count > 0) {
      parts.push({ kind: "person", userId: row.user_id, count: row.count });
    }
  }
  if (queue.left_open.length) parts.push({ kind: "left-open", count: queue.left_open.length });
  return parts;
}

export function undecidedObjects(summary: Pick<SignOffSummary, "objects">): {
  readonly undecided: number;
  readonly total: number;
} | null {
  const objects = summary.objects;
  if (objects === undefined || objects.undecided <= 0) return null;
  return { undecided: objects.undecided, total: objects.total };
}
