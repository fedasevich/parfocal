import type { SlideDetail, SlideDetailsChange, SpecimenDetail } from "@parfocal/api-client";

export type SlideDraft = {
  id: string;
  label: string;
  stain: string;
  blockId: string | null;
  level: string;
};

export type BlockChoice = { id: string; name: string };

export const draftOf = (slide: SlideDetail): SlideDraft => ({
  id: slide.id,
  label: slide.label,
  stain: slide.stain,
  blockId: slide.block_id,
  level: slide.level === null ? "" : String(slide.level),
});

export const blockChoices = (specimens: SpecimenDetail[]): BlockChoice[] =>
  specimens.flatMap((specimen) =>
    specimen.blocks.map((block) => ({ id: block.id, name: `${specimen.letter}${block.number}` })),
  );

export function moveSlide<T extends { id: string }>(rows: T[], id: string, step: -1 | 1): T[] {
  const from = rows.findIndex((row) => row.id === id);
  const to = from + step;
  if (from === -1 || to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return rows;
  next.splice(to, 0, moved);
  return next;
}

const levelOf = (text: string): number | null => (text.trim() === "" ? null : Number(text.trim()));

export function slideErrors(draft: SlideDraft, all: SlideDraft[]): string[] {
  const errors: string[] = [];
  const label = draft.label.trim();
  if (label === "") errors.push("Give the slide a label.");
  else if (all.some((other) => other.id !== draft.id && other.label.trim() === label))
    errors.push(`Another slide is already labelled ${label}.`);
  if (draft.stain.trim() === "") errors.push("Give the stain.");
  const level = levelOf(draft.level);
  if (level !== null && !(Number.isInteger(level) && level >= 1 && level <= 50))
    errors.push("The level is a whole number from 1 to 50.");
  return errors;
}

export function slideChange(before: SlideDetail, draft: SlideDraft): SlideDetailsChange | null {
  const change: SlideDetailsChange = {};
  const label = draft.label.trim();
  const stain = draft.stain.trim();
  const level = levelOf(draft.level);
  if (label !== before.label) change.label = label;
  if (stain !== before.stain) change.stain = stain;
  if (draft.blockId !== before.block_id) change.block_id = draft.blockId;
  if (level !== before.level) change.level = level;
  return Object.keys(change).length > 0 ? change : null;
}

export const orderChanged = (before: SlideDetail[], drafts: SlideDraft[]) =>
  before.some((slide, index) => drafts[index]?.id !== slide.id);
