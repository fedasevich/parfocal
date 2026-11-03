export type Point = { readonly x: number; readonly y: number };

export type PolygonDraft = readonly Point[];

export type DraftStep =
  | { readonly kind: "draft"; readonly draft: PolygonDraft }
  | { readonly kind: "closed"; readonly points: Float32Array };

export const closeRadiusScreenPixels = 8;
export const minimumVertices = 3;

const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= closeRadiusScreenPixels;

export function closeDraft(draft: PolygonDraft): DraftStep {
  if (draft.length < minimumVertices) return { kind: "draft", draft };
  return { kind: "closed", points: Float32Array.from(draft.flatMap((p) => [p.x, p.y])) };
}

export function clickDraft(
  draft: PolygonDraft,
  slide: Point,
  toScreen: (point: Point) => Point,
): DraftStep {
  const screen = toScreen(slide);
  const first = draft[0];
  if (first !== undefined && draft.length >= minimumVertices && near(toScreen(first), screen)) {
    return closeDraft(draft);
  }
  const last = draft.at(-1);
  if (last !== undefined && near(toScreen(last), screen)) return { kind: "draft", draft };
  return { kind: "draft", draft: [...draft, slide] };
}
