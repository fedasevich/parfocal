export type SavePhase = "idle" | "saving" | "saved" | "retrying" | "failed" | "conflict";

export type NoticeKind = "conflict" | "not-saved" | "offline" | "changes";

export type SaveWord = "saving" | "saved" | "waiting" | "not-saved" | null;

export type NoticeFacts = {
  readonly phase: SavePhase;
  readonly attempt: number;
  readonly conflicts: number;
  readonly lost: boolean;
  readonly incoming: number;
};

export type NoticePlan = {
  readonly shown: NoticeKind | null;
  readonly waiting: readonly NoticeKind[];
  readonly word: SaveWord;
  readonly urgency: "assertive" | "polite" | null;
};

export const offlineAfterAttempts = 3;

export const noticeOrder: readonly NoticeKind[] = ["conflict", "not-saved", "offline", "changes"];

const present = (facts: NoticeFacts): Record<NoticeKind, boolean> => ({
  conflict: facts.conflicts > 0,
  "not-saved": facts.lost,
  offline: facts.phase === "retrying" && facts.attempt >= offlineAfterAttempts,
  changes: facts.incoming > 0,
});

function wordOf(facts: NoticeFacts, has: Record<NoticeKind, boolean>): SaveWord {
  if (has["not-saved"]) return "not-saved";
  if (facts.phase === "retrying") return "waiting";
  if (facts.phase === "saving") return "saving";
  if (facts.phase === "saved" && !has.conflict) return "saved";
  return null;
}

export function planNotices(facts: NoticeFacts): NoticePlan {
  const has = present(facts);
  const [shown = null, ...waiting] = noticeOrder.filter((kind) => has[kind]);
  return {
    shown,
    waiting,
    word: wordOf(facts, has),
    urgency: shown === null ? null : shown === "changes" ? "polite" : "assertive",
  };
}
