import { type CommentLinker, CommentLinksProvider } from "@parfocal/ui/lib/comment-links";
import { type ReactNode, useCallback } from "react";
import { reachMention, useLayerNames } from "./comment-bus.ts";
import { linkParts } from "./comment-link-parts.ts";
import { useReferenceList } from "./comment-references.ts";

export function CommentLinksHost({ children }: { children: ReactNode }) {
  const names = useLayerNames();
  const references = useReferenceList();
  const linker = useCallback<CommentLinker>(
    (text) => linkParts(text, names, (target) => reachMention(target), references),
    [names, references],
  );
  return <CommentLinksProvider value={linker}>{children}</CommentLinksProvider>;
}
