import { fallbackColour } from "../viewer/class-paint.ts";
import type { OutlineTyping, Shape } from "./shapes.ts";

export type ClassColour = (classKey: string | null) => string | null;

export function typingOfShape(shape: Shape): OutlineTyping | undefined {
  return shape.provenance.kind === "model" ? shape.provenance.typing : undefined;
}

export function typeConfidence(typing: OutlineTyping): number {
  return typing.probabilities[typing.type] ?? 0;
}

const hexOf = (colour: readonly number[]) =>
  `#${colour
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;

export function shapeColour(shape: Shape, classColour: ClassColour): string | null {
  const own = shape.classKey === null ? null : classColour(shape.classKey);
  if (own !== null) return own;
  const typing = typingOfShape(shape);
  return typing === undefined ? null : hexOf(fallbackColour(typing.type));
}

export type CellTypeText = {
  readonly name: string;
  readonly typed: { readonly type: string; readonly percent: number } | null;
  readonly changed: boolean;
};

export function cellTypeText(
  shape: Shape,
  className: (classKey: string) => string | null,
): CellTypeText | null {
  const typing = typingOfShape(shape);
  const named = shape.classKey === null ? null : className(shape.classKey);
  if (named === null && typing === undefined) return null;
  const typed =
    typing === undefined
      ? null
      : { type: typing.type, percent: Math.round(typeConfidence(typing) * 100) };
  const name = named ?? typed?.type ?? "";
  return { name, typed, changed: typed !== null && name.toLowerCase() !== typed.type };
}
