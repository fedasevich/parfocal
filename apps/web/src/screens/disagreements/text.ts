import type { QueueAnswerRecord, QueueRow } from "@parfocal/api-client";
import type { ClaimSource } from "@parfocal/ui/lib/counts-as-rule";
import { answersFor, type ProjectClass } from "@parfocal/ui/lib/decision-answers";
import { countsAs, type ReviewStyle } from "../review/decision-mapping.ts";

export type Answer = "agree" | "disagree" | "unsure";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad";

export const answerWord: Record<Answer, string> = {
  agree: "Agree",
  disagree: "Disagree",
  unsure: "Not sure",
};

export const answerOf = (raw: string): Answer =>
  raw === "agree" || raw === "disagree" ? raw : "unsure";

export const answerTone: Record<Answer, Tone> = { agree: "ok", disagree: "bad", unsure: "warn" };

const shortReason = (reason: string) => reason.replace(/^Need a /, "").toLowerCase();

export const answerText = (answer: { raw: Answer; reason: string | null }) =>
  `${answerWord[answer.raw]}${answer.reason ? ` · ${shortReason(answer.reason)}` : ""}`;

export const tagText: Record<QueueRow["tag"], string> = {
  differ: "reviewers differ",
  bothai: "both vs AI",
  second: "second look asked",
  outline: "outline differs",
};

export const tagOf = (tag: QueueRow["tag"], reviewers?: number, drawer?: string) => {
  if (tag === "bothai" && drawer !== undefined) {
    return reviewers === 1 ? `the reviewer vs ${drawer}` : `both vs ${drawer}`;
  }
  return tag === "bothai" && reviewers === 1 ? "the reviewer vs AI" : tagText[tag];
};

type Names = (userId: string | null | undefined) => string | undefined;

const toolWords: Record<string, string> = {
  hand: "by hand",
  "smart-select": "with Smart select",
};

export const drawerOf = (row: Pick<QueueRow, "drawn_by_user_id">, nameOf: Names) =>
  nameOf(row.drawn_by_user_id) ?? "the drawer";

export function drawnText(row: Pick<QueueRow, "drawn_by_user_id" | "tool">, nameOf: Names) {
  const who = nameOf(row.drawn_by_user_id) ?? "a person";
  const how = row.tool ? toolWords[row.tool] : undefined;
  return how ? `Drawn by ${who} ${how}` : `Drawn by ${who}`;
}
export const rowCode = (row: Pick<QueueRow, "object" | "drawn">) =>
  row.drawn ? `${row.object}⁺` : row.object;

export const rowLabel = (row: Pick<QueueRow, "object" | "slide_label" | "drawn">) =>
  row.slide_label === "A1" ? rowCode(row) : `${rowCode(row)} on ${row.slide_label}`;

export const claimText = (ai: QueueRow["ai"]) =>
  ai.score == null ? ai.class_name : `${ai.class_name}, ${Math.round(ai.score * 100)}% sure`;

const firstName = (name: string | undefined) => name?.split(" ")[0] ?? "";

export function rowTag(
  row: QueueRow,
  nameOf: (userId: string | null | undefined) => string | undefined,
  look: { style: ReviewStyle; classes: ProjectClass[]; reviewers?: number | undefined },
): { label: string; tone: Tone } {
  const who = nameOf(row.adjudicator?.user_id) ?? "the adjudicator";
  if (row.state === "decided" && row.decision) {
    return {
      label: styledWord(look.style, row.decision.raw, look.classes, row.ai.class_name),
      tone: answerTone[countOf(look.style, row.decision.raw, row.ai.class_name)],
    };
  }
  if (row.state === "adjudicated" && row.decision) {
    return {
      label: `${styledWord(look.style, row.decision.raw, look.classes, row.ai.class_name)} · ${firstName(who)}`,
      tone: answerTone[countOf(look.style, row.decision.raw, row.ai.class_name)],
    };
  }
  if (row.state === "left-open") return { label: "left open", tone: "neutral" };
  if (row.state === "with-adjudicator") return { label: `with ${who}`, tone: "accent" };
  if (row.state === "declined") return { label: `declined by ${who}`, tone: "warn" };
  if (row.state === "look-again") return { label: "asked to look again", tone: "accent" };
  if (row.edited) return { label: "edited after decisions", tone: "warn" };
  return {
    label: tagOf(row.tag, look.reviewers, row.drawn ? drawerOf(row, nameOf) : undefined),
    tone: "neutral",
  };
}

export const isClosed = (row: QueueRow) =>
  ["decided", "left-open", "with-adjudicator", "adjudicated"].includes(row.state);

export const canSend = (row: QueueRow) => row.state === "open" || row.state === "declined";

const against: Record<ClaimSource, string> = { ai: "the AI", drawn: "the drawn outline" };

const verbOf = (raw: Answer, source: ClaimSource) =>
  raw === "unsure" ? "is not sure" : `${raw}s with ${against[source]}`;

type Anonymous = { raw: Answer; reason: string | null };

export function adjudicatorWhy(a: Anonymous, b: Anonymous, source: ClaimSource = "ai") {
  const second = (answer: Anonymous) => answer.reason === "Need a second look";
  if (second(a) || second(b)) {
    return `One reviewer asked for a second look, the other ${verbOf(second(a) ? b.raw : a.raw, source)}`;
  }
  if (a.raw === b.raw) {
    return a.raw === "unsure"
      ? "Neither reviewer is sure"
      : `Both reviewers ${a.raw} with ${against[source]}`;
  }
  return `One reviewer ${verbOf(a.raw, source)}, the other ${verbOf(b.raw, source)}`;
}

export function countOf(style: ReviewStyle, raw: string, aiClass: string): Answer {
  return countsAs(style, raw, { class_name: aiClass });
}

export function styledWord(
  style: ReviewStyle,
  raw: string,
  classes: ProjectClass[],
  aiClass: string,
): string {
  const found = answersFor(style.kind, classes).find((item) => item.raw === raw);
  if (found === undefined) return answerWord[countOf(style, raw, aiClass)];
  return style.kind === "certainty" ? `${found.raw} · ${found.label}` : found.label;
}

export function styledText(
  style: ReviewStyle,
  answer: Pick<QueueAnswerRecord, "raw" | "reason">,
  classes: ProjectClass[],
  aiClass: string,
): string {
  const word = styledWord(style, answer.raw, classes, aiClass);
  return `${word}${answer.reason ? ` · ${shortReason(answer.reason)}` : ""}`;
}

export type QueueFilter = "all" | "rev" | "ai";

export const filterRows = (rows: QueueRow[], filter: QueueFilter) =>
  rows.filter((item) => filter === "all" || (filter === "ai") === (item.tag === "bothai"));

export const filterCounts = (rows: QueueRow[]) => ({
  all: rows.length,
  rev: rows.filter((item) => item.tag !== "bothai").length,
  ai: rows.filter((item) => item.tag === "bothai").length,
});

export const allClosed = (rows: QueueRow[]) => rows.length > 0 && rows.every(isClosed);

export function nextOpen(rows: QueueRow[], from: QueueRow): QueueRow | undefined {
  const at = rows.indexOf(from);
  return [...rows.slice(at + 1), ...rows.slice(0, at)].find((candidate) => !isClosed(candidate));
}
