import type { ChangeSummary } from "./live-batch.ts";

const count = (n: number, verb: string) => (n === 0 ? null : `${verb} ${n}`);

export function describeChange(summary: ChangeSummary, name: string): string {
  const parts = [
    count(summary.added, "added"),
    count(summary.changed, "changed"),
    count(summary.removed, "removed"),
  ].filter((part) => part !== null);
  return `${name} ${parts.join(", ")}`;
}

export function describeChanges(
  changes: readonly ChangeSummary[],
  nameOf: (userId: string | null) => string | undefined,
): string {
  return changes
    .map((summary) => describeChange(summary, nameOf(summary.by) ?? "A colleague"))
    .join(". ");
}
