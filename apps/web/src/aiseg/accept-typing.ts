import { ApiError, type OutlineTypes, type TypedOutline, typeOutlines } from "@parfocal/api-client";
import { mayNotBeNucleus } from "@parfocal/ui/lib/not-a-nucleus";
import { type AnnotationDocument, typeShape } from "../annotations/document.ts";
import { boundsOf, type OutlineTyping, type Shape } from "../annotations/shapes.ts";
import {
  GpuCallCancelledError,
  type GpuCancel,
  serverGpuCancel,
  untilGpuAnswers,
} from "../gpu/gpu-wait.ts";
import { smartSource } from "./smart-run.ts";

export const typedSources: ReadonlySet<string> = new Set([smartSource]);

export type OutlineTyper = (
  slideId: string,
  outlines: readonly { points: number[] }[],
) => Promise<OutlineTypes>;

export const typerAttemptMs = 90_000;

export class TyperTimeoutError extends Error {
  constructor() {
    super("The typer took too long to answer");
    this.name = "TyperTimeoutError";
  }
}

export function typerOf(
  cancelCall: GpuCancel = serverGpuCancel,
  attemptMs: number = typerAttemptMs,
): OutlineTyper {
  return (slideId, outlines) =>
    untilGpuAnswers(
      "typer",
      async (call, signal) => {
        const params = call === null ? undefined : { call };
        const timer = AbortSignal.timeout(attemptMs);
        const both = AbortSignal.any([signal, timer]);
        const response = await typeOutlines(slideId, { outlines: [...outlines] }, params, {
          signal: both,
        }).catch((error: unknown) => {
          throw timer.aborted && !signal.aborted ? new TyperTimeoutError() : error;
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

export type TypingFailure =
  | { readonly reason: "offline" }
  | { readonly reason: "timeout" }
  | { readonly reason: "network" }
  | { readonly reason: "cancelled" }
  | { readonly reason: "refused"; readonly status: number; readonly title: string | null };

export type TypingOutcome =
  | { readonly kind: "nothing" }
  | {
      readonly kind: "typed";
      readonly count: number;
      readonly scaleAssumed: boolean;
      readonly apply: (latest: AnnotationDocument) => AnnotationDocument;
    }
  | { readonly kind: "failed"; readonly count: number; readonly failure: TypingFailure };

export function typingFailureOf(error: unknown): TypingFailure {
  if (error instanceof TyperTimeoutError) return { reason: "timeout" };
  if (error instanceof GpuCallCancelledError) return { reason: "cancelled" };
  if (!(error instanceof ApiError)) return { reason: "offline" };
  if (error.kind === "network") return { reason: "network" };
  if (error.status >= 500 || error.status === 0) return { reason: "offline" };
  return { reason: "refused", status: error.status, title: error.problem?.title ?? null };
}

type TypablePiece = {
  readonly run: { readonly source: string | null };
  readonly ring: Float32Array;
};

export function splitForTyping<T extends TypablePiece>(
  pieces: readonly T[],
  autoType: boolean,
): { readonly typed: T[]; readonly untyped: T[]; readonly kept: T[] } {
  const typed: T[] = [];
  const untyped: T[] = [];
  const kept: T[] = [];
  for (const piece of pieces) {
    const found = piece.run.source !== null && typedSources.has(piece.run.source);
    if (!found) kept.push(piece);
    else if (!autoType) untyped.push(piece);
    else if (typed.length < typerBatch && typerSized(piece.ring)) typed.push(piece);
    else kept.push(piece);
  }
  return { typed, untyped, kept };
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
    if (!answerFits(answer, targets))
      return { kind: "failed", count, failure: { reason: "offline" } };
    return {
      kind: "typed",
      count,
      scaleAssumed: answer.scale_assumed === true,
      apply: (latest) => withTypings(latest, targets, answer, classOfType),
    };
  } catch (error) {
    return { kind: "failed", count, failure: typingFailureOf(error) };
  }
}
