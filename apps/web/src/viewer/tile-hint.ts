import type { TileLoadState } from "./viewer-engine.ts";

export const hintAfterMs = 1000;

export const slowAfterMs = 5000;

export type TileHint =
  | { readonly kind: "opening" }
  | { readonly kind: "loading"; readonly left: number }
  | { readonly kind: "slow"; readonly answers: string };

export function secondsLabel(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function tileHintOf(state: TileLoadState, opening = false): TileHint | null {
  if (!opening && state.pending === 0) return null;
  if (state.waitingMs < hintAfterMs) return null;
  if (state.waitingMs >= slowAfterMs) {
    return { kind: "slow", answers: secondsLabel(state.answerMs ?? state.waitingMs) };
  }
  return opening ? { kind: "opening" } : { kind: "loading", left: state.pending };
}

export function hintCopy(hint: TileHint): string {
  if (hint.kind === "opening") return "Loading the slide";
  if (hint.kind === "loading") return `Loading sharper tiles · ${hint.left} left`;
  return `Slow source. The slide storage answers in ${hint.answers}. Keep reading, the view sharpens as tiles arrive. Lower magnifications come first.`;
}

export type SlideRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export function clipToStage(
  rect: SlideRect,
  stage: { readonly width: number; readonly height: number },
): SlideRect {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(stage.width, rect.left + rect.width);
  const bottom = Math.min(stage.height, rect.top + rect.height);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
