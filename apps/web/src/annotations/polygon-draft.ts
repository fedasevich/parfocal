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

export function snapTo45(draft: PolygonDraft, slide: Point): Point {
  const last = draft.at(-1);
  if (last === undefined) return slide;
  const dx = slide.x - last.x;
  const dy = slide.y - last.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return slide;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: last.x + Math.cos(angle) * length, y: last.y + Math.sin(angle) * length };
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
