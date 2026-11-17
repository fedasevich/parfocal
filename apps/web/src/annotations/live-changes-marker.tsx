import { Trans } from "@lingui/react/macro";
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
      className="flex w-full items-center justify-center bg-accent/10 px-4 py-1.5 text-body-sm text-fg hover:bg-accent/15"
    >
      <Trans>{text}. Show changes</Trans>
    </button>
  );
}
