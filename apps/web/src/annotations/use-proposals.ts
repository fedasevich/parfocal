import { useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  type ClassOfType,
  type OutlineTyper,
  serverTyper,
  splitForTyping,
  type TypingFailure,
  type TypingOutcome,
  typeAccepted,
  typerAttemptMs,
} from "../aiseg/accept-typing.ts";
import { showUndoToast } from "../shell/undo-toasts.tsx";
import { acceptProposals, discardProposals, type Proposal, pendingProposals } from "./proposals.ts";
import type { Shape } from "./shapes.ts";
import type { SavedAnnotations } from "./use-saved-annotations.ts";

export type TypingState =
  | { readonly state: "idle" }
  | { readonly state: "working"; readonly count: number };

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
  readonly onAccepted?: (shapes: readonly Shape[]) => void;
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
    const { autoType, classOfType, typer = serverTyper, onAccepted } = now.current;
    const { typed, untyped, kept } = splitForTyping(pendingProposals(document), autoType);
    const first = acceptProposals(document, typed, { classKey: null });
    const bare = acceptProposals(first.document, untyped, { classKey: null });
    const second = acceptProposals(bare.document, kept);
    apply(second.document, "Accept proposals");
    if (autoType) onAccepted?.([...first.shapes, ...bare.shapes]);
    if (first.shapes.length === 0) return;
    const call = ++calls.current;
    const count = first.shapes.length;
    setTypingState({ state: "working", count });
    const failed = (failure: TypingFailure) => {
      const left = t`${count} cells are left untyped. Select one and press 1 to 4 to type it.`;
      showUndoToast({ message: `${failureText(failure)} ${left}` });
    };
    const finish = (outcome: TypingOutcome) => {
      if (outcome.kind === "failed") return failed(outcome.failure);
      if (outcome.kind === "nothing") return;
      const before = latest();
      const next = outcome.apply(before);
      if (next !== before) apply(next, "Type accepted outlines");
      if (outcome.scaleAssumed) {
        showUndoToast({
          message: t`The slide states no microns per pixel, so the typer assumed 0.25 µm per pixel.`,
        });
      }
    };
    const failureText = (failure: TypingFailure): string => {
      switch (failure.reason) {
        case "timeout":
          return t`The typer took longer than ${typerAttemptMs / 1000} s to answer.`;
        case "network":
          return t`The network dropped while typing.`;
        case "cancelled":
          return t`Typing was cancelled.`;
        case "refused":
          return failure.title === null
            ? t`The typer refused the cells (${failure.status}).`
            : t`The typer refused the cells: ${failure.title}.`;
        case "offline":
          return t`The typer did not answer.`;
      }
    };
    void typeAccepted(slideId, second.document, first.shapes, typer, classOfType)
      .then(finish)
      .catch(() => failed({ reason: "offline" }))
      .finally(() => {
        if (call === calls.current) setTypingState({ state: "idle" });
      });
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
