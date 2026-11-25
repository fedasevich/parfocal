import { aiHistoryLimit, type Ring } from "../annotations/ai-edit.ts";

export type OutlineDraft = {
  readonly object: string;
  readonly base: Ring;
  readonly steps: readonly Ring[];
  readonly cursor: number;
};

const sameRing = (left: Ring, right: Ring) =>
  left.length === right.length &&
  left.every((point, index) => point[0] === right[index]?.[0] && point[1] === right[index]?.[1]);

export const startOutline = (object: string, ring: Ring): OutlineDraft => ({
  object,
  base: ring,
  steps: [ring],
  cursor: 0,
});

export const outlineRing = (draft: OutlineDraft): Ring => draft.steps[draft.cursor] ?? draft.base;

export const outlineChanged = (draft: OutlineDraft): boolean =>
  !sameRing(outlineRing(draft), draft.base);

export function pushOutline(draft: OutlineDraft, ring: Ring): OutlineDraft {
  if (sameRing(ring, outlineRing(draft))) return draft;
  const steps = [...draft.steps.slice(0, draft.cursor + 1), ring].slice(-(aiHistoryLimit + 1));
  return { ...draft, steps, cursor: steps.length - 1 };
}

export const undoOutline = (draft: OutlineDraft): OutlineDraft =>
  draft.cursor > 0 ? { ...draft, cursor: draft.cursor - 1 } : draft;

export const redoOutline = (draft: OutlineDraft): OutlineDraft =>
  draft.cursor < draft.steps.length - 1 ? { ...draft, cursor: draft.cursor + 1 } : draft;
