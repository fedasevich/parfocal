import type { ResultSetStates } from "./result-set-state.ts";

export const slideNoticeOrder = [
  "remote-offline",
  "no-result",
  "result-failed",
  "result-importing",
  "no-pixel-size",
] as const;

export type SlideNoticeKind = (typeof slideNoticeOrder)[number];

export type SlideNoticeFacts = {
  readonly remoteOffline: boolean;
  readonly noResult: boolean;
  readonly resultSets: ResultSetStates | null;
  readonly micronsPerPixel: number | null | undefined;
};

function shown(kind: SlideNoticeKind, facts: SlideNoticeFacts): boolean {
  switch (kind) {
    case "remote-offline":
      return facts.remoteOffline;
    case "no-result":
      return facts.noResult;
    case "result-failed":
      return (facts.resultSets?.failed.length ?? 0) > 0;
    case "result-importing":
      return (facts.resultSets?.importing.length ?? 0) > 0;
    case "no-pixel-size":
      return facts.micronsPerPixel === null;
  }
}

export function slideNoticesOf(facts: SlideNoticeFacts): readonly SlideNoticeKind[] {
  return slideNoticeOrder.filter((kind) => shown(kind, facts));
}
