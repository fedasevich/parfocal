export type ReturnKind =
  | "my-work"
  | "project"
  | "disagreements"
  | "adjudication"
  | "evaluation"
  | "sign-off"
  | "task-comments"
  | "search"
  | "notifications"
  | "home";

export type ReturnPage = { readonly href: string; readonly kind: ReturnKind };

export const myWorkReturn: ReturnPage = { href: "/my-work", kind: "my-work" };

const pages: readonly (readonly [RegExp, ReturnKind])[] = [
  [/^\/my-work\/?$/, "my-work"],
  [/^\/projects\/[^/]+\/?$/, "project"],
  [/^\/tasks\/[^/]+\/disagreements\/?$/, "disagreements"],
  [/^\/tasks\/[^/]+\/adjudicate\/?$/, "adjudication"],
  [/^\/tasks\/[^/]+\/evaluation\/?$/, "evaluation"],
  [/^\/tasks\/[^/]+\/sign-off\/?$/, "sign-off"],
  [/^\/tasks\/[^/]+\/comments\/?$/, "task-comments"],
  [/^\/search\/?$/, "search"],
  [/^\/notifications\/?$/, "notifications"],
  [/^\/$/, "home"],
];

const viewerPages: readonly RegExp[] = [
  /^\/projects\/[^/]+\/slides\//,
  /^\/tasks\/[^/]+\/(guided|cells|submitted)\/?$/,
  /^\/popout\/?$/,
];

export function isViewerPage(pathname: string): boolean {
  return viewerPages.some((pattern) => pattern.test(pathname));
}

export function returnPageOf(pathname: string, href: string): ReturnPage | null {
  const found = pages.find(([pattern]) => pattern.test(pathname));
  if (found === undefined) return null;
  const kind = found[1];
  return { href: kind === "search" ? pathname : href, kind };
}

export function nextReturnPage(
  before: ReturnPage | null,
  pathname: string,
  href: string,
): ReturnPage | null {
  if (isViewerPage(pathname)) return before;
  return returnPageOf(pathname, href);
}

const storageKey = "parfocal.viewer-return";

export function readReturnPage(storage: Pick<Storage, "getItem"> | undefined): ReturnPage | null {
  const raw = storage?.getItem(storageKey);
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReturnPage>;
    if (typeof parsed.href !== "string" || typeof parsed.kind !== "string") return null;
    if (!parsed.href.startsWith("/") || parsed.href.startsWith("//")) return null;
    const url = new URL(parsed.href, "https://parfocal.invalid");
    return returnPageOf(url.pathname, parsed.href);
  } catch {
    return null;
  }
}

export function writeReturnPage(
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  page: ReturnPage | null,
): void {
  if (storage === undefined) return;
  if (page === null) storage.removeItem(storageKey);
  else storage.setItem(storageKey, JSON.stringify(page));
}
