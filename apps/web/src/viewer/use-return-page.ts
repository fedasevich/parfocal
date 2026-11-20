import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  myWorkReturn,
  nextReturnPage,
  type ReturnPage,
  readReturnPage,
  writeReturnPage,
} from "./return-page.ts";

const sessionStore = (): Storage | undefined =>
  typeof window === "undefined" ? undefined : window.sessionStorage;

export function useRememberReturnPage(): void {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const href = useRouterState({ select: (state) => state.location.href });
  useEffect(() => {
    const store = sessionStore();
    const before = readReturnPage(store);
    const next = nextReturnPage(before, pathname, href);
    if (next?.href !== before?.href) writeReturnPage(store, next);
  }, [pathname, href]);
}

export function useReturnPage(): ReturnPage {
  const [page] = useState(() => readReturnPage(sessionStore()) ?? myWorkReturn);
  return page;
}
