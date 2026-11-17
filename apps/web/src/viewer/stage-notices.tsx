import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";
import { ConflictNotice } from "../annotations/conflict-notice.tsx";
import type { ChangeSummary } from "../annotations/live-batch.ts";
import { LiveChangesMarker } from "../annotations/live-changes-marker.tsx";
import type { Choice } from "../annotations/save-queue.ts";
import { SaveStatus } from "../annotations/save-status.tsx";
import type { SaveConflict, SaveState } from "../annotations/use-saved-annotations.ts";

export type NoticeSlots = {
  readonly banner: HTMLElement | null;
  readonly status: HTMLElement | null;
};

const NoticeSlotsContext = createContext<NoticeSlots | null>(null);

export const NoticeSlotsProvider = NoticeSlotsContext.Provider;

function Into({ node, children }: { node: HTMLElement | null | undefined; children: ReactNode }) {
  return node ? createPortal(children, node) : null;
}

type StageNoticesProps = {
  showSave: boolean;
  saveState: SaveState;
  unsaved: number;
  incoming: readonly ChangeSummary[];
  onShowIncoming: () => void;
  conflicts: readonly SaveConflict[];
  onResolve: (conflict: SaveConflict, choice: Choice) => void;
};

export function StageNotices({
  showSave,
  saveState,
  unsaved,
  incoming,
  onShowIncoming,
  conflicts,
  onResolve,
}: StageNoticesProps) {
  const slots = useContext(NoticeSlotsContext);
  return (
    <>
      <Into node={slots?.status}>
        {showSave ? <SaveStatus state={saveState} unsaved={unsaved} /> : null}
      </Into>
      <Into node={slots?.banner}>
        <LiveChangesMarker changes={incoming} onShow={onShowIncoming} />
        <ConflictNotice conflicts={conflicts} onResolve={onResolve} />
      </Into>
    </>
  );
}
