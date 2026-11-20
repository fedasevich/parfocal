import type { QueueRow } from "@parfocal/api-client";

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
