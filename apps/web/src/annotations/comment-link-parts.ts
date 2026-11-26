import type { CommentLinkPart } from "@parfocal/ui/lib/comment-links";
import type { LayerName, Reach } from "./comment-bus.ts";

const objectId = "[TCRZMAN]\\d+(?:[·.][TCRZMAN]?\\d+)*[⁺+]?";

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function linkParts(
  text: string,
  names: readonly LayerName[],
  reach: (target: Reach) => void,
): CommentLinkPart[] {
  const layers = [...names]
    .filter((item) => item.name.trim() !== "")
    .sort((a, b) => b.name.length - a.name.length);
  const layerPart = layers.map((item) => `#${literal(item.name)}`).join("|");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${objectId})(?![\\p{L}\\p{N}_])${layerPart ? `|(${layerPart})` : ""}`,
    "gu",
  );
  const parts: CommentLinkPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const [whole, object, layer] = match;
    if (object !== undefined) {
      parts.push({ text: whole, reach: () => reach({ kind: "object", id: object }) });
    } else if (layer !== undefined) {
      const found = layers.find((item) => `#${item.name}` === layer);
      parts.push(
        found === undefined
          ? whole
          : { text: whole, reach: () => reach({ kind: "layer", key: found.key }) },
      );
    }
    last = at + whole.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
