import { useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  type ClassOfType,
  type OutlineTyper,
  serverTyper,
  splitForTyping,
  typeAccepted,
} from "../aiseg/accept-typing.ts";
import { showUndoToast } from "../shell/undo-toasts.tsx";
import { acceptProposals, discardProposals, type Proposal, pendingProposals } from "./proposals.ts";
import type { SavedAnnotations } from "./use-saved-annotations.ts";

export type TypingState =
  | { readonly state: "idle" }
  | { readonly state: "working"; readonly count: number }
  | { readonly state: "failed"; readonly count: number };

export type ProposalControls = {
  readonly pending: readonly Proposal[];
  readonly typesOnAccept: boolean;
  readonly typing: TypingState;
  readonly accept: () => void;
  readonly discard: () => void;
};

export type ProposalTyping = {
  readonly autoType: boolean;
  readonly classOfType: ClassOfType;
  readonly typer?: OutlineTyper;
};

export function useProposals(
  saved: SavedAnnotations,
  slideId: string,
  typing: ProposalTyping,
): ProposalControls {
  const { t } = useLingui();
  const { document, apply, latest } = saved;
  const pending = useMemo(() => pendingProposals(document), [document]);
  const [typingState, setTypingState] = useState<TypingState>({ state: "idle" });
  const now = useRef(typing);
  now.current = typing;
  const calls = useRef(0);

  const accept = useCallback(() => {
    const { autoType, classOfType, typer = serverTyper } = now.current;
    const { typed, untyped, kept } = splitForTyping(pendingProposals(document), autoType);
    const first = acceptProposals(document, typed, { classKey: null });
    const bare = acceptProposals(first.document, untyped, { classKey: null });
    const second = acceptProposals(bare.document, kept);
    apply(second.document, "Accept proposals");
    if (first.shapes.length === 0) return;
    const call = ++calls.current;
    const count = first.shapes.length;
    setTypingState({ state: "working", count });
    void typeAccepted(slideId, second.document, first.shapes, typer, classOfType).then(
      (outcome) => {
        const last = call === calls.current;
        if (outcome.kind === "failed") {
          if (last) setTypingState({ state: "failed", count: outcome.count });
          showUndoToast({
            message: t`The typer did not answer, so ${outcome.count} cells are left untyped. Select one and press 1 to 4 to type it.`,
          });
          return;
        }
        if (last) setTypingState({ state: "idle" });
        if (outcome.kind === "nothing") return;
        const before = latest();
        const next = outcome.apply(before);
        if (next !== before) apply(next, "Type accepted outlines");
      },
    );
  }, [apply, document, latest, slideId, t]);

  const discard = useCallback(() => {
    apply(discardProposals(document), "Discard proposals");
  }, [apply, document]);

  const typesOnAccept = useMemo(
    () => pending.length > 0 && splitForTyping(pending, typing.autoType).kept.length === 0,
    [pending, typing.autoType],
  );

  return { pending, typesOnAccept, typing: typingState, accept, discard };
}
