import { SaveStatusWord, ViewerNotices } from "@parfocal/ui/components/viewer-notices";
import { planNotices } from "@parfocal/ui/lib/viewer-notices";
import { createContext, type ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { ConflictPreview, conflictId, conflictText } from "../annotations/conflict-preview.tsx";
import type { ChangeSummary } from "../annotations/live-batch.ts";
import { describeChanges } from "../annotations/live-changes-text.ts";
import type { Choice } from "../annotations/save-queue.ts";
import type { SaveConflict, SaveState } from "../annotations/use-saved-annotations.ts";
import { usePeople } from "../screens/people.ts";

export type NoticeSlots = {
  readonly banner: HTMLElement | null;
  readonly status: HTMLElement | null;
  readonly lock?: ReactNode;
  readonly finish?: HTMLElement | null;
};

const NoticeSlotsContext = createContext<NoticeSlots | null>(null);

export const NoticeSlotsProvider = NoticeSlotsContext.Provider;

export const useFinishSlot = () => useContext(NoticeSlotsContext)?.finish ?? null;

function Into({ node, children }: { node: HTMLElement | null | undefined; children: ReactNode }) {
  return node ? createPortal(children, node) : null;
}

type StageNoticesProps = {
  showSave: boolean;
  saveState: SaveState;
  unsaved: number;
  attempt: number;
  refused: number;
  onRetry: () => void;
  incoming: readonly ChangeSummary[];
  onShowIncoming: () => void;
  conflicts: readonly SaveConflict[];
  onResolve: (conflict: SaveConflict, choice: Choice) => void;
};

function conflictView(
  conflicts: readonly SaveConflict[],
  onResolve: (conflict: SaveConflict, choice: Choice) => void,
) {
  const conflict = conflicts[0];
  if (conflict === undefined) return undefined;
  const hasMine = conflict.action === "update" || !conflict.theirs.deleted;
  const outlines = {
    mine: conflict.mine !== null,
    theirs: !conflict.theirs.deleted,
  };
  return {
    outlines,
    id: conflictId(conflict),
    title: conflictText(conflict),
    preview: <ConflictPreview conflict={conflict} />,
    more: conflicts.length - 1,
    onKeepMine: hasMine ? () => onResolve(conflict, "mine") : undefined,
    onKeepTheirs: () => onResolve(conflict, "theirs"),
  };
}

export function StageNotices({
  showSave,
  saveState,
  unsaved,
  attempt,
  refused,
  onRetry,
  incoming,
  onShowIncoming,
  conflicts,
  onResolve,
}: StageNoticesProps) {
  const slots = useContext(NoticeSlotsContext);
  const personOf = usePeople();
  const [dismissed, setDismissed] = useState(0);
  const plan = planNotices({
    phase: saveState,
    attempt,
    conflicts: conflicts.length,
    lost: refused > dismissed,
    incoming: incoming.length,
  });
  const changes =
    incoming.length === 0
      ? undefined
      : {
          text: describeChanges(incoming, (userId) => personOf(userId)?.name),
          onShow: onShowIncoming,
        };
  return (
    <>
      <Into node={slots?.status}>
        {showSave ? <SaveStatusWord word={plan.word} unsaved={unsaved} /> : null}
      </Into>
      <Into node={slots?.banner}>
        <ViewerNotices
          plan={plan}
          unsaved={unsaved}
          conflict={conflictView(conflicts, onResolve)}
          changes={changes}
          onRetry={onRetry}
          onDismissNotSaved={() => setDismissed(refused)}
        />
        {plan.shown === null ? slots?.lock : null}
      </Into>
    </>
  );
}
