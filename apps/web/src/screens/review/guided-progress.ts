import type { Count } from "./decision-style.ts";

export type DotGlyph = "check" | "cross" | "question";

export const dotGlyphOf = (value: Count | undefined): DotGlyph | null => {
  if (value === "agree") return "check";
  if (value === "disagree") return "cross";
  if (value === "unsure") return "question";
  return null;
};

export const dotStateWord = (value: Count | undefined, skipped: boolean): string => {
  if (value === "unsure") return "not sure";
  if (value) return value;
  return skipped ? "skipped, still open" : "not answered yet";
};

export function nextOpenIndex(
  order: readonly string[],
  from: number,
  isAnswered: (object: string) => boolean,
): number | null {
  const ahead = order.findIndex((object, at) => at > from && !isAnswered(object));
  if (ahead >= 0) return ahead;
  const wrapped = order.findIndex((object) => !isAnswered(object));
  return wrapped >= 0 ? wrapped : null;
}
