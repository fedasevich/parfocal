import {
  type AnnotationDocument,
  openPieces,
  type PromotionPatch,
  pieceKey,
  promoteRunPiece,
} from "./document.ts";
import { type ModelRun, pieceConfidence, pieceRing } from "./runs.ts";
import type { RunId, Shape } from "./shapes.ts";

export interface ProposalRef {
  readonly runId: RunId;
  readonly piece: number;
}

export interface Proposal extends ProposalRef {
  readonly run: ModelRun;
  readonly ring: Float32Array;
  readonly confidence: number;
  readonly classKey: string | null;
}

export interface AcceptOptions {
  readonly groupId?: PromotionPatch["groupId"];
  readonly classKey?: PromotionPatch["classKey"];
}

export interface Accepted {
  readonly document: AnnotationDocument;
  readonly shapes: readonly Shape[];
}

export function pendingProposals(doc: AnnotationDocument): Proposal[] {
  const pending: Proposal[] = [];
  for (const run of doc.runs.values()) {
    for (const piece of openPieces(doc, run.id)) {
      pending.push({
        runId: run.id,
        piece,
        run,
        ring: pieceRing(run, piece),
        confidence: pieceConfidence(run, piece),
        classKey: run.classKey,
      });
    }
  }
  return pending;
}

export function pendingCount(doc: AnnotationDocument): number {
  let count = 0;
  for (const run of doc.runs.values()) count += openPieces(doc, run.id).length;
  return count;
}

export function isPending(doc: AnnotationDocument, ref: ProposalRef): boolean {
  const run = doc.runs.get(ref.runId);
  if (run === undefined) return false;
  if (!Number.isInteger(ref.piece) || ref.piece < 0 || ref.piece >= run.count) return false;
  const key = pieceKey(ref.runId, ref.piece);
  return !doc.promoted.has(key) && !doc.dismissed.has(key);
}

function chosen(doc: AnnotationDocument, refs: readonly ProposalRef[] | undefined): ProposalRef[] {
  const candidates = refs ?? pendingProposals(doc);
  const seen = new Set<string>();
  const picked: ProposalRef[] = [];
  for (const ref of candidates) {
    const key = pieceKey(ref.runId, ref.piece);
    if (seen.has(key) || !isPending(doc, ref)) continue;
    seen.add(key);
    picked.push({ runId: ref.runId, piece: ref.piece });
  }
  return picked;
}

export function acceptProposals(
  doc: AnnotationDocument,
  refs?: readonly ProposalRef[],
  options: AcceptOptions = {},
): Accepted {
  let document = doc;
  const shapes: Shape[] = [];
  const patch: PromotionPatch = {
    groupId: options.groupId ?? null,
    ...(options.classKey === undefined ? {} : { classKey: options.classKey }),
  };
  for (const ref of chosen(doc, refs)) {
    const promoted = promoteRunPiece(document, ref.runId, ref.piece, patch);
    document = promoted.document;
    shapes.push(promoted.shape);
  }
  return { document, shapes };
}

export function discardProposals(
  doc: AnnotationDocument,
  refs?: readonly ProposalRef[],
): AnnotationDocument {
  const picked = chosen(doc, refs);
  if (picked.length === 0) return doc;
  const dismissed = new Set(doc.dismissed);
  for (const ref of picked) dismissed.add(pieceKey(ref.runId, ref.piece));
  return { ...doc, dismissed };
}
