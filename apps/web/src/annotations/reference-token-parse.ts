import type { Thread } from "@parfocal/api-client";
import type { Reach } from "./comment-bus.ts";

export const referenceToken = /#\[([^\]|\n]{1,120})\|(area|slide):([\w,.-]{1,80})\]/gu;

const areaAnchor = (payload: string): Thread["anchor"] | null => {
  const corners = payload.split(",").map(Number);
  if (corners.length !== 4 || corners.some((value) => !Number.isFinite(value))) return null;
  const [left = 0, top = 0, right = 0, bottom = 0] = corners;
  return {
    kind: "shape",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
          [left, top],
        ],
      ],
    },
  };
};

export function reachOfToken(kind: string, payload: string): Reach | null {
  if (kind === "slide") return { kind: "slide", slideId: payload };
  const anchor = kind === "area" ? areaAnchor(payload) : null;
  return anchor === null ? null : { kind: "anchor", anchor };
}

export const plainReferenceText = (text: string) =>
  text.replace(referenceToken, (_found, name: string) => name);
