import { type CommentLinker, CommentLinksProvider } from "@parfocal/ui/lib/comment-links";
import { type ReactNode, useCallback } from "react";
import { reachMention, useLayerNames } from "./comment-bus.ts";
import { linkParts } from "./comment-link-parts.ts";

export function CommentLinksHost({ children }: { children: ReactNode }) {
  const names = useLayerNames();
  const linker = useCallback<CommentLinker>(
    (text) => linkParts(text, names, reachMention),
    [names],
  );
  return <CommentLinksProvider value={linker}>{children}</CommentLinksProvider>;
}
