import { usePeople } from "../screens/people.ts";
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

export function LiveChangesMarker({
  changes,
  onShow,
}: {
  changes: readonly ChangeSummary[];
  onShow: () => void;
}) {
  const personOf = usePeople();
  if (changes.length === 0) return null;
  const text = changes
    .map((summary) => describeChange(summary, personOf(summary.by)?.name ?? "A colleague"))
    .join(". ");
  return (
    <button
      type="button"
      data-testid="changes-by"
      onClick={onShow}
      className="absolute top-16 left-1/2 z-5 -translate-x-1/2 rounded-full border border-line bg-surface px-3 py-1 text-body-sm text-fg shadow-pop"
    >
      {text}. Show changes
    </button>
  );
}
