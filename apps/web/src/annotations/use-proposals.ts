import { useCallback, useMemo } from "react";
import { acceptProposals, discardProposals, type Proposal, pendingProposals } from "./proposals.ts";
import type { SavedAnnotations } from "./use-saved-annotations.ts";

export type ProposalControls = {
  readonly pending: readonly Proposal[];
  readonly accept: () => void;
  readonly discard: () => void;
};

export function useProposals(saved: SavedAnnotations): ProposalControls {
  const { document, apply } = saved;
  const pending = useMemo(() => pendingProposals(document), [document]);

  const accept = useCallback(() => {
    apply(acceptProposals(document).document, "Accept proposals");
  }, [apply, document]);

  const discard = useCallback(() => {
    apply(discardProposals(document), "Discard proposals");
  }, [apply, document]);

  return { pending, accept, discard };
}
