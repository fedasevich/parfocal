import { type OutlineTypes, type TypedOutline, typeOutlines } from "@parfocal/api-client";
import { mayNotBeNucleus } from "@parfocal/ui/lib/not-a-nucleus";
import { type AnnotationDocument, typeShape } from "../annotations/document.ts";
import type { OutlineTyping, Shape } from "../annotations/shapes.ts";
import { smartSource } from "./smart-run.ts";

export const typedSources: ReadonlySet<string> = new Set([smartSource]);

export type OutlineTyper = (
  slideId: string,
  outlines: readonly { points: number[] }[],
) => Promise<OutlineTypes>;

export const serverTyper: OutlineTyper = async (slideId, outlines) =>
  (await typeOutlines(slideId, { outlines: [...outlines] })).data;

export const typerBatch = 500;

export type KnownClass = (classKey: string) => boolean;

export function typingTargets(doc: AnnotationDocument, shapes: readonly Shape[]): Shape[] {
  return shapes.filter((shape) => {
    if (shape.provenance.kind !== "model" || shape.provenance.typing !== undefined) return false;
    const source = doc.runs.get(shape.provenance.runId)?.source;
    return source != null && typedSources.has(source);
  });
}

function typingOf(answer: OutlineTypes, typed: TypedOutline, confidence: number | null) {
  return {
    typer: answer.typer,
    version: answer.version,
    probabilities: typed.probabilities,
    type: typed.type,
    alternatives: typed.alternatives,
    foreground: typed.foreground,
    mayNotBeNucleus: mayNotBeNucleus({ detectorScore: confidence, foreground: typed.foreground }),
  } satisfies OutlineTyping;
}

export function withTypings(
  doc: AnnotationDocument,
  targets: readonly Shape[],
  answer: OutlineTypes,
  knownClass: KnownClass = () => false,
): AnnotationDocument {
  if (!answer.calibrated || answer.outlines.length !== targets.length) return doc;
  let next = doc;
  targets.forEach((target, index) => {
    const typed = answer.outlines[index];
    const current = next.shapes.get(target.id);
    if (typed === undefined || current === undefined) return;
    if (current.provenance.kind !== "model" || current.provenance.edited) return;
    if (current.points !== target.points) return;
    const classKey =
      current.classKey === null && knownClass(typed.type) ? typed.type : current.classKey;
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
  knownClass?: KnownClass,
): Promise<((latest: AnnotationDocument) => AnnotationDocument) | null> {
  const targets = typingTargets(doc, shapes).slice(0, typerBatch);
  if (targets.length === 0) return null;
  try {
    const answer = await typer(
      slideId,
      targets.map((shape) => ({ points: Array.from(shape.points) })),
    );
    return (latest) => withTypings(latest, targets, answer, knownClass);
  } catch {
    return null;
  }
}
