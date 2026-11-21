import type { AdjudicationObject, QueueRow } from "@parfocal/api-client";

type Rgba = readonly [number, number, number, number];

export type ReviewerOutline = {
  readonly id: string;
  readonly userId: string;
  readonly ring: readonly number[];
  readonly colour: Rgba;
  readonly hex: string;
};

const reviewerColours: readonly { colour: Rgba; hex: string }[] = [
  { colour: [0, 190, 255, 255], hex: "#00beff" },
  { colour: [255, 0, 200, 255], hex: "#ff00c8" },
  { colour: [255, 214, 0, 255], hex: "#ffd600" },
  { colour: [120, 255, 90, 255], hex: "#78ff5a" },
];

const white = { colour: [255, 255, 255, 255] as Rgba, hex: "#ffffff" };

export const settledHex = white.hex;

export function settledStageOutline<Outline extends { readonly ring: readonly number[] }>(
  outlines: readonly Outline[],
  object: string,
  settled: readonly number[] | undefined,
): (Outline | { id: string; ring: readonly number[]; colour: Rgba; hex: string })[] {
  if (settled === undefined || settled.length < 6) return [...outlines];
  return [...outlines, { id: `${object}:settled`, ring: settled, ...white }];
}

export type LetterOutline = {
  readonly id: string;
  readonly letter: string;
  readonly ring: readonly number[];
  readonly colour: Rgba;
  readonly hex: string;
};

export function letterOutlines(object: AdjudicationObject | undefined): LetterOutline[] {
  if (object === undefined) return [];
  return [...(object.outlines ?? [])]
    .filter((entry) => entry.outline.length >= 6)
    .sort((a, b) => a.reviewer.localeCompare(b.reviewer))
    .map((entry, index) => ({
      id: `${object.object}:${entry.reviewer}`,
      letter: entry.reviewer,
      ring: entry.outline,
      ...(reviewerColours[index % reviewerColours.length] ?? white),
    }));
}

export function reviewerOutlines(
  row: Pick<QueueRow, "object" | "outlines" | "answers">,
): ReviewerOutline[] {
  const order = row.answers.map((answer) => answer.user_id);
  const rank = (userId: string) => {
    const at = order.indexOf(userId);
    return at === -1 ? order.length : at;
  };
  return [...(row.outlines ?? [])]
    .filter((entry) => entry.outline.length >= 6)
    .sort((a, b) => rank(a.user_id) - rank(b.user_id) || a.user_id.localeCompare(b.user_id))
    .map((entry, index) => {
      const paint = reviewerColours[index % reviewerColours.length] ?? white;
      return {
        id: `${row.object}:${entry.user_id}`,
        userId: entry.user_id,
        ring: entry.outline,
        ...paint,
      };
    });
}
