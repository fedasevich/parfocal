import { type RefObject, useCallback } from "react";
import type { AiEditBridge } from "../annotations/ai-edit.ts";
import type { DraftControl } from "../annotations/polygon-layer.tsx";
import type { SmartQueueControl } from "../annotations/smart-layer.tsx";
import type { TextControl } from "../annotations/text-layer.tsx";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";

type UndoKeys = {
  readonly draft: RefObject<DraftControl | null>;
  readonly text: RefObject<TextControl | null>;
  readonly smartQueue: RefObject<SmartQueueControl | null>;
  readonly aiBridge: RefObject<AiEditBridge>;
  readonly aiIsNewer: () => boolean;
  readonly undoEdit: () => void;
  readonly redoEdit: () => void;
};

export function useUndoKeys({
  draft,
  text,
  smartQueue,
  aiBridge,
  aiIsNewer,
  undoEdit,
  redoEdit,
}: UndoKeys) {
  const bindings = useBindings(["global"], ["undo", "redo"]);
  const onKey = useCallback(
    ({ phase, action }: { phase: string; action: string }) => {
      if (phase !== "press") return;
      const aiFirst = aiIsNewer();
      if (action === "redo") {
        if (smartQueue.current?.canRedo() === true) {
          smartQueue.current.redo();
          return;
        }
        if (!aiFirst || !aiBridge.current.redo()) redoEdit();
        return;
      }
      if (action !== "undo") return;
      const queued = smartQueue.current;
      const drafting = draft.current;
      if (queued !== null && queued.count() > 0) queued.pop();
      else if (drafting !== null && drafting.depth() > 0) drafting.pop();
      else if (text.current?.restore() === true) return;
      else if (!aiFirst || !aiBridge.current.undo()) undoEdit();
    },
    [undoEdit, redoEdit, aiBridge, aiIsNewer, draft, text, smartQueue],
  );
  useHotkeys(bindings, onKey);
}
