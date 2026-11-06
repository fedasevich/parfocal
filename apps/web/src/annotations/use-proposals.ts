import { useCallback, useMemo } from "react";
import { type OutlineTyper, serverTyper, typeAccepted } from "../aiseg/accept-typing.ts";
import { acceptProposals, discardProposals, type Proposal, pendingProposals } from "./proposals.ts";
import type { SavedAnnotations } from "./use-saved-annotations.ts";

export type ProposalControls = {
  readonly pending: readonly Proposal[];
  readonly accept: () => void;
  readonly discard: () => void;
};

export function useProposals(
  saved: SavedAnnotations,
  slideId: string,
  typer: OutlineTyper = serverTyper,
): ProposalControls {
  const { document, apply, latest } = saved;
  const pending = useMemo(() => pendingProposals(document), [document]);

  const accept = useCallback(() => {
    const accepted = acceptProposals(document);
    apply(accepted.document, "Accept proposals");
    void typeAccepted(slideId, accepted.document, accepted.shapes, typer).then((typed) => {
      if (typed === null) return;
      const before = latest();
      const next = typed(before);
      if (next !== before) apply(next, "Type accepted outlines");
    });
  }, [apply, document, latest, slideId, typer]);

  const discard = useCallback(() => {
    apply(discardProposals(document), "Discard proposals");
  }, [apply, document]);

  return { pending, accept, discard };
}
