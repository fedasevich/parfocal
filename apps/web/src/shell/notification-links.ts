import type { CommentLinker } from "@parfocal/ui/lib/comment-links";
import { linkParts } from "../annotations/comment-link-parts.ts";

const base = "http://parfocal.local";

export function linkToObject(link: string, objectId: string): string {
  const url = new URL(link, base);
  if (url.origin !== base || !url.pathname.includes("/slides/")) return link;
  url.searchParams.set("object", objectId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export const notificationLinker =
  (link: string, open: (to: string) => void): CommentLinker =>
  (text) =>
    linkParts(text, [], (target) => {
      if (target.kind === "object") open(linkToObject(link, target.id));
    });
