import { at, boundsOf, type Extent, type RunId } from "./shapes.ts";

export interface ModelRun {
  readonly id: RunId;
  readonly model: string;
  readonly version: string | null;
  readonly label: string;
  readonly source: string | null;
  readonly classKey: string | null;
  readonly count: number;
  readonly positions: Float32Array;
  readonly startIndices: Uint32Array;
  readonly confidence: Float32Array;
  readonly bounds: Extent;
}

export interface RunProposal {
  readonly points: Float32Array;
  readonly confidence: number;
}

export interface RunInput {
  readonly id: RunId;
  readonly model: string;
  readonly version?: string | null;
  readonly label?: string;
  readonly source?: string | null;
  readonly classKey?: string | null;
}

export function runFromProposals(input: RunInput, proposals: readonly RunProposal[]): ModelRun {
  let vertices = 0;
  for (const proposal of proposals) vertices += proposal.points.length >> 1;

  const positions = new Float32Array(vertices * 2);
  const startIndices = new Uint32Array(proposals.length + 1);
  const confidence = new Float32Array(proposals.length);
  let cursor = 0;
  proposals.forEach((proposal, index) => {
    startIndices[index] = cursor;
    positions.set(proposal.points, cursor * 2);
    confidence[index] = proposal.confidence;
    cursor += proposal.points.length >> 1;
  });
  startIndices[proposals.length] = cursor;

  return {
    id: input.id,
    model: input.model,
    version: input.version ?? null,
    label: input.label ?? input.model,
    source: input.source ?? null,
    classKey: input.classKey ?? null,
    count: proposals.length,
    positions,
    startIndices,
    confidence,
    bounds: boundsOf(positions),
  };
}

export function hasPiece(run: ModelRun, piece: number): boolean {
  return Number.isInteger(piece) && piece >= 0 && piece < run.count;
}

export function pieceRing(run: ModelRun, piece: number): Float32Array {
  return run.positions.subarray(
    at(run.startIndices, piece) * 2,
    at(run.startIndices, piece + 1) * 2,
  );
}

export function pieceBounds(run: ModelRun, piece: number): Extent {
  return boundsOf(pieceRing(run, piece));
}

export function pieceConfidence(run: ModelRun, piece: number): number {
  return at(run.confidence, piece);
}

export function runBytes(run: ModelRun): number {
  return run.positions.byteLength + run.startIndices.byteLength + run.confidence.byteLength;
}
