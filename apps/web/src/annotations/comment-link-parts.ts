import type { CommentLinkPart } from "@parfocal/ui/lib/comment-links";
import type { LayerName, Reach } from "./comment-bus.ts";
import type { Reference } from "./comment-references.ts";
import { reachOfToken, referenceToken } from "./reference-token-parse.ts";

const objectId = "[TCRZMAN]\\d+(?:[·.][TCRZMAN]?\\d+)*[⁺+]?";

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function linkParts(
  text: string,
  names: readonly LayerName[],
  reach: (target: Reach) => void,
  extra: readonly Pick<Reference, "text" | "reach">[] = [],
): CommentLinkPart[] {
  const parts: CommentLinkPart[] = [];
  let last = 0;
  for (const match of text.matchAll(referenceToken)) {
    const at = match.index ?? 0;
    const [whole, name = "", kind = "", payload = ""] = match;
    const found = reachOfToken(kind, payload);
    if (at > last) parts.push(...plainParts(text.slice(last, at), names, reach, extra));
    parts.push(found === null ? name : { text: name, reach: () => reach(found) });
    last = at + whole.length;
  }
  if (last < text.length) parts.push(...plainParts(text.slice(last), names, reach, extra));
  return parts;
}

function plainParts(
  text: string,
  names: readonly LayerName[],
  reach: (target: Reach) => void,
  extra: readonly Pick<Reference, "text" | "reach">[],
): CommentLinkPart[] {
  const named = new Map<string, Reach>();
  for (const item of extra) {
    if (item.text.trim() !== "") named.set(item.text, item.reach);
  }
  for (const item of names) {
    if (item.name.trim() !== "") named.set(`#${item.name}`, { kind: "layer", key: item.key });
  }
  const namedPart = [...named.keys()]
    .sort((a, b) => b.length - a.length)
    .map(literal)
    .join("|");
  const edge = "(?<![\\p{L}\\p{N}_])";
  const end = "(?![\\p{L}\\p{N}_])";
  const namedEnd = "(?![\\p{L}\\p{N}_·⁺+]|\\.[\\p{L}\\p{N}])";
  const pattern = new RegExp(
    `${namedPart ? `${edge}(${namedPart})${namedEnd}|` : "()"}${edge}(${objectId})${end}`,
    "gu",
  );
  const parts: CommentLinkPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const [whole, name, object] = match;
    const found = name === undefined || name === "" ? undefined : named.get(name);
    if (found !== undefined) {
      parts.push({ text: whole, reach: () => reach(found) });
    } else if (object !== undefined) {
      parts.push({ text: whole, reach: () => reach({ kind: "object", id: object }) });
    } else {
      parts.push(whole);
    }
    last = at + whole.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
