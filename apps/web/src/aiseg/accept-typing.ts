import { type OutlineTypes, type TypedOutline, typeOutlines } from "@parfocal/api-client";
import { mayNotBeNucleus } from "@parfocal/ui/lib/not-a-nucleus";
import { type AnnotationDocument, typeShape } from "../annotations/document.ts";
import { boundsOf, type OutlineTyping, type Shape } from "../annotations/shapes.ts";
import { type GpuCancel, serverGpuCancel, untilGpuAnswers } from "../gpu/gpu-wait.ts";
import { smartSource } from "./smart-run.ts";

export const typedSources: ReadonlySet<string> = new Set([smartSource]);

export type OutlineTyper = (
  slideId: string,
  outlines: readonly { points: number[] }[],
) => Promise<OutlineTypes>;

export function typerOf(cancelCall: GpuCancel = serverGpuCancel): OutlineTyper {
  return (slideId, outlines) =>
    untilGpuAnswers(
      "typer",
      async (call, signal) => {
        const params = call === null ? undefined : { call };
        const response = await typeOutlines(slideId, { outlines: [...outlines] }, params, {
          signal,
        });
        if (response.status === 202) return { waiting: response.data };
        if (response.status !== 200) throw new Error("The typer did not answer");
        return { answered: response.data };
      },
      cancelCall,
    );
}

export const serverTyper: OutlineTyper = typerOf();

export const typerBatch = 500;

export const typerSpan = 512;

export const typerPoints = 4096;

export function typerSized(points: Float32Array): boolean {
  const [minX, minY, maxX, maxY] = boundsOf(points);
  return (
    points.length >= 6 &&
    points.length <= typerPoints &&
    maxX - minX <= typerSpan &&
    maxY - minY <= typerSpan
  );
}

export type ClassOfType = (type: string) => string | null;

export type TypingOutcome =
  | { readonly kind: "nothing" }
  | {
      readonly kind: "typed";
      readonly count: number;
      readonly apply: (latest: AnnotationDocument) => AnnotationDocument;
    }
  | { readonly kind: "failed"; readonly count: number };

type TypablePiece = {
  readonly run: { readonly source: string | null };
  readonly ring: Float32Array;
};

export function splitForTyping<T extends TypablePiece>(
  pieces: readonly T[],
  autoType: boolean,
): { readonly typed: T[]; readonly kept: T[] } {
  const typed: T[] = [];
  const kept: T[] = [];
  for (const piece of pieces) {
    const typable =
      autoType &&
      typed.length < typerBatch &&
      piece.run.source !== null &&
      typedSources.has(piece.run.source) &&
      typerSized(piece.ring);
    (typable ? typed : kept).push(piece);
  }
  return { typed, kept };
}

export function typingTargets(doc: AnnotationDocument, shapes: readonly Shape[]): Shape[] {
  return shapes.filter((shape) => {
    if (shape.provenance.kind !== "model" || shape.provenance.typing !== undefined) return false;
    if (!typerSized(shape.points)) return false;
    const source = doc.runs.get(shape.provenance.runId)?.source;
    return source != null && typedSources.has(source);
  });
}

function typingOf(answer: OutlineTypes, typed: TypedOutline, confidence: number | null) {
  return {
    typer: answer.typer,
    version: answer.version,
    probabilities: { ...typed.probabilities },
    type: typed.type,
    alternatives: typed.alternatives,
    foreground: typed.foreground,
    mayNotBeNucleus: mayNotBeNucleus({ detectorScore: confidence, foreground: typed.foreground }),
  } satisfies OutlineTyping;
}

function answerFits(answer: OutlineTypes, targets: readonly Shape[]): boolean {
  return answer.calibrated && answer.outlines.length === targets.length;
}

export function withTypings(
  doc: AnnotationDocument,
  targets: readonly Shape[],
  answer: OutlineTypes,
  classOfType: ClassOfType = () => null,
): AnnotationDocument {
  if (!answerFits(answer, targets)) return doc;
  let next = doc;
  targets.forEach((target, index) => {
    const typed = answer.outlines[index];
    const current = next.shapes.get(target.id);
    if (typed === undefined || current === undefined) return;
    if (current.provenance.kind !== "model" || current.provenance.edited) return;
    if (current.points !== target.points) return;
    const classKey = current.classKey ?? classOfType(typed.type);
    const typing = typingOf(answer, typed, current.provenance.confidence);
    next = typeShape(next, current.id, typing, classKey).document;
  });
  return next;
}

export async function typeAccepted(
  slideId: string,
  doc: AnnotationDocument,
  shapes: readonly Shape[],
  typer: OutlineTyper,
  classOfType?: ClassOfType,
): Promise<TypingOutcome> {
  const targets = typingTargets(doc, shapes).slice(0, typerBatch);
  if (targets.length === 0) return { kind: "nothing" };
  const count = targets.length;
  try {
    const answer = await typer(
      slideId,
      targets.map((shape) => ({ points: Array.from(shape.points) })),
    );
    if (!answerFits(answer, targets)) return { kind: "failed", count };
    return {
      kind: "typed",
      count,
      apply: (latest) => withTypings(latest, targets, answer, classOfType),
    };
  } catch {
    return { kind: "failed", count };
  }
}
