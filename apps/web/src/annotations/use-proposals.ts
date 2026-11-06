import { useCallback, useMemo, useRef } from "react";
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
  const { document, apply } = saved;
  const pending = useMemo(() => pendingProposals(document), [document]);
  const latest = useRef(document);
  latest.current = document;

  const accept = useCallback(() => {
    const accepted = acceptProposals(document);
    apply(accepted.document, "Accept proposals");
    void typeAccepted(slideId, accepted.document, accepted.shapes, typer).then((typed) => {
      if (typed === null) return;
      const next = typed(latest.current);
      if (next !== latest.current) apply(next, "Type accepted outlines");
    });
  }, [apply, document, slideId, typer]);

  const discard = useCallback(() => {
    apply(discardProposals(document), "Discard proposals");
  }, [apply, document]);

  return { pending, accept, discard };
}
