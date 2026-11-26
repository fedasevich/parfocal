import { createContext, useContext } from "react";

export type CommentLinkPart = string | { readonly text: string; readonly reach: () => void };

export type CommentLinker = (text: string) => readonly CommentLinkPart[];

const CommentLinksContext = createContext<CommentLinker | null>(null);

export const CommentLinksProvider = CommentLinksContext.Provider;

export const useCommentLinker = () => useContext(CommentLinksContext);
