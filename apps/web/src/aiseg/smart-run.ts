import { type AnnotationDocument, addRun, openPieces, removeRun } from "../annotations/document.ts";
import { type ModelRun, type RunProposal, runFromProposals } from "../annotations/runs.ts";
import type { RunId } from "../annotations/shapes.ts";
import type { SmartSnapshot } from "./smart-session.ts";

export const smartModel = "pathosam";

export const smartSource = "smart-select";

export function piecesOf(snapshot: SmartSnapshot): RunProposal[] {
  const pieces: RunProposal[] = [];
  for (const object of [...snapshot.kept, ...(snapshot.live === null ? [] : [snapshot.live])]) {
    if (object.ring !== null) pieces.push({ points: object.ring, confidence: object.confidence });
  }
  return pieces;
}

export function smartRun(
  id: RunId,
  classKey: string | null,
  snapshot: SmartSnapshot,
): ModelRun | null {
  const pieces = piecesOf(snapshot);
  if (pieces.length === 0) return null;
  return runFromProposals(
    { id, model: smartModel, label: "Smart select", source: smartSource, classKey },
    pieces,
  );
}

export function nextRunId(doc: AnnotationDocument): RunId {
  let highest = 0;
  for (const id of doc.runs.keys()) highest = Math.max(highest, id);
  return highest + 1;
}

export function withSmartRun(
  doc: AnnotationDocument,
  id: RunId,
  classKey: string | null,
  snapshot: SmartSnapshot,
): AnnotationDocument {
  const run = smartRun(id, classKey, snapshot);
  if (run === null) return doc.runs.has(id) ? removeRun(doc, id) : doc;
  return addRun(doc, run);
}

export function smartRunFinished(doc: AnnotationDocument, id: RunId): boolean {
  return doc.runs.has(id) && openPieces(doc, id).length === 0;
}
