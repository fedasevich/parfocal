import { clearConfirmCount } from "./clear.ts";
import { type AnnotationDocument, updateShape } from "./document.ts";
import {
  type Accepted,
  type AcceptOptions,
  acceptProposals,
  discardProposals,
  isPending,
  type ProposalRef,
  pendingProposals,
} from "./proposals.ts";
import type { Geometry, RunId } from "./shapes.ts";

export const promoteConfirmCount = clearConfirmCount;

export class ConfirmationRequiredError extends Error {
  readonly count: number;

  constructor(count: number) {
    super(`Promoting ${count} pieces needs a confirmation`);
    this.name = "ConfirmationRequiredError";
    this.count = count;
  }
}

export interface PromotionScope {
  readonly refs?: readonly ProposalRef[];
  readonly runId?: RunId;
  readonly minConfidence?: number;
}

export interface Pruned {
  readonly document: AnnotationDocument;
  readonly dropped: number;
}

function confidenceOf(doc: AnnotationDocument, ref: ProposalRef): number {
  return doc.runs.get(ref.runId)?.confidence[ref.piece] ?? 0;
}

function scoped(doc: AnnotationDocument, scope: PromotionScope): ProposalRef[] {
  const pool = scope.refs ?? pendingProposals(doc);
  return pool
    .filter((ref) => scope.runId === undefined || ref.runId === scope.runId)
    .filter((ref) => isPending(doc, ref))
    .filter(
      (ref) => scope.minConfidence === undefined || confidenceOf(doc, ref) >= scope.minConfidence,
    )
    .map((ref) => ({ runId: ref.runId, piece: ref.piece }));
}

export function bulkPromotionCount(doc: AnnotationDocument, scope: PromotionScope = {}): number {
  return scoped(doc, scope).length;
}

export function needsPromotionConfirmation(count: number): boolean {
  return count > promoteConfirmCount;
}

export function promotionPrompt(count: number): string {
  return `Turn ${count.toLocaleString("en-US")} AI pieces into shapes? Undo takes them back.`;
}

export function promoteInBulk(
  doc: AnnotationDocument,
  scope: PromotionScope = {},
  options: AcceptOptions & { readonly confirmed?: boolean } = {},
): Accepted {
  const refs = scoped(doc, scope);
  if (needsPromotionConfirmation(refs.length) && options.confirmed !== true) {
    throw new ConfirmationRequiredError(refs.length);
  }
  return acceptProposals(doc, refs, options);
}

export function promoteOnEdit(
  doc: AnnotationDocument,
  ref: ProposalRef,
  geometry: Geometry,
  options: AcceptOptions = {},
): Accepted {
  const accepted = acceptProposals(doc, [ref], options);
  const first = accepted.shapes[0];
  if (first === undefined) return accepted;
  const edited = updateShape(accepted.document, first.id, { geometry });
  return { document: edited.document, shapes: [edited.shape] };
}

export function pruneLeastConfident(
  doc: AnnotationDocument,
  count: number,
  scope: Pick<PromotionScope, "runId"> = {},
): Pruned {
  const ranked = scoped(doc, scope).sort(
    (a, b) => confidenceOf(doc, a) - confidenceOf(doc, b) || a.runId - b.runId || a.piece - b.piece,
  );
  const doomed = ranked.slice(0, Math.max(0, Math.floor(count)));
  return { document: discardProposals(doc, doomed), dropped: doomed.length };
}

export function pruneBelow(
  doc: AnnotationDocument,
  threshold: number,
  scope: Pick<PromotionScope, "runId"> = {},
): Pruned {
  const doomed = scoped(doc, scope).filter((ref) => confidenceOf(doc, ref) < threshold);
  return { document: discardProposals(doc, doomed), dropped: doomed.length };
}
