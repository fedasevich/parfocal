import { useLingui } from "@lingui/react";
import { useMatches } from "@tanstack/react-router";
import { useEffect } from "react";
import { create } from "zustand";
import { routeTitleMessages } from "./page-title-names.ts";
import { pageTitleOf, routeTitleOf } from "./page-title-parts.ts";

const titleStore = create<{ detail: string | null }>(() => ({ detail: null }));

export function usePageTitleDetail(detail: string | null | undefined) {
  useEffect(() => {
    if (!detail) return;
    titleStore.setState({ detail });
    return () => titleStore.setState({ detail: null });
  }, [detail]);
}

export default function PageTitle() {
  const { i18n } = useLingui();
  const routeIds = useMatches({ select: (matches) => matches.map((match) => match.routeId) });
  const detail = titleStore((state) => state.detail);
  const titles = Object.fromEntries(
    Object.entries(routeTitleMessages).map(([id, message]) => [id, i18n._(message)]),
  );
  const title = pageTitleOf([detail, routeTitleOf(routeIds, titles)]);
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}
