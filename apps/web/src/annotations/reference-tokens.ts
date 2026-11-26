import type { Thread } from "@parfocal/api-client";
import { type Mentionable, toMentionTokens } from "../screens/review/mention-picking.ts";
import { threadTarget } from "../viewer/thread-target.ts";
import type { Reach } from "./comment-bus.ts";
import { type Reference, referenceList } from "./comment-references.ts";

export const referenceToken = /#\[([^\]|\n]{1,120})\|(area|slide):([\w,.-]{1,80})\]/gu;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function tokenOf(reference: Pick<Reference, "text" | "reach">): string | null {
  if (/[|\]\n]/.test(reference.text) || reference.text.trim() === "") return null;
  const { reach } = reference;
  if (reach.kind === "slide") return `#[${reference.text}|slide:${reach.slideId}]`;
  if (reach.kind !== "anchor") return null;
  const area = threadTarget(reach.anchor, []);
  if (area === null) return null;
  const corners = [area.x, area.y, area.x + area.width, area.y + area.height].map(Math.round);
  return `#[${reference.text}|area:${corners.join(",")}]`;
}

export function toReferenceTokens(
  text: string,
  references: readonly Pick<Reference, "text" | "reach">[],
): string {
  const tokens = new Map<string, string>();
  for (const reference of references) {
    const token = tokenOf(reference);
    if (token !== null && !tokens.has(reference.text)) tokens.set(reference.text, token);
  }
  if (tokens.size === 0) return text;
  const names = [...tokens.keys()]
    .sort((a, b) => b.length - a.length)
    .map(literal)
    .join("|");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_\\[|])(${names})(?![\\p{L}\\p{N}_·⁺+|]|\\.[\\p{L}\\p{N}])`,
    "gu",
  );
  return text
    .split(/(@\[[^\]]*\]|#\[[^\]]*\])/)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(pattern, (found: string) => tokens.get(found) ?? found),
    )
    .join("");
}

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

export const commentBody = (text: string, members: Pick<Mentionable, "id" | "name">[]) =>
  toReferenceTokens(toMentionTokens(text, members), referenceList());
