import type { QueueAnswerRecord, QueueRow } from "@parfocal/api-client";
import { cellShapes, regionShapes } from "../review/slide-geometry.ts";
import type { StillView } from "../review/slide-still.tsx";

export type Answer = "agree" | "disagree" | "unsure";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad";

export const answerWord: Record<Answer, string> = {
  agree: "Agree",
  disagree: "Disagree",
  unsure: "Not sure",
};

export const answerTone: Record<Answer, Tone> = { agree: "ok", disagree: "bad", unsure: "warn" };

const shortReason = (reason: string) => reason.replace(/^Need a /, "").toLowerCase();

export const answerText = (answer: Pick<QueueAnswerRecord, "raw" | "reason">) =>
  `${answerWord[answer.raw]}${answer.reason ? ` · ${shortReason(answer.reason)}` : ""}`;

export const tagText: Record<QueueRow["tag"], string> = {
  differ: "reviewers differ",
  bothai: "both vs AI",
  second: "second look asked",
};

export const rowLabel = (row: Pick<QueueRow, "object" | "slide_label">) =>
  row.slide_label === "A1" ? row.object : `${row.object} on ${row.slide_label}`;

export const claimText = (ai: QueueRow["ai"]) =>
  `${ai.class_name}, ${Math.round(ai.score * 100)}% sure`;

const firstName = (name: string | undefined) => name?.split(" ")[0] ?? "";

export function rowTag(
  row: QueueRow,
  nameOf: (userId: string | null | undefined) => string | undefined,
): { label: string; tone: Tone } {
  const who = nameOf(row.adjudicator?.user_id) ?? "the adjudicator";
  if (row.state === "decided" && row.decision) {
    return { label: answerWord[row.decision.raw], tone: answerTone[row.decision.raw] };
  }
  if (row.state === "adjudicated" && row.decision) {
    return {
      label: `${answerWord[row.decision.raw]} · ${firstName(who)}`,
      tone: answerTone[row.decision.raw],
    };
  }
  if (row.state === "left-open") return { label: "left open", tone: "neutral" };
  if (row.state === "with-adjudicator") return { label: `with ${who}`, tone: "accent" };
  if (row.state === "declined") return { label: `declined by ${who}`, tone: "warn" };
  if (row.state === "look-again") return { label: "asked to look again", tone: "accent" };
  if (row.edited) return { label: "edited after decisions", tone: "warn" };
  return { label: tagText[row.tag], tone: "neutral" };
}

export const isClosed = (row: QueueRow) =>
  ["decided", "left-open", "with-adjudicator", "adjudicated"].includes(row.state);

export const canSend = (row: QueueRow) => row.state === "open" || row.state === "declined";

const firstCell = Object.keys(cellShapes)[0] ?? "T1·C101";

export function stillOf(row: Pick<QueueRow, "object" | "kind">): StillView {
  if (row.kind === "cell") {
    return { kind: "cell", object: row.object in cellShapes ? row.object : firstCell };
  }
  return { kind: "region", object: row.object in regionShapes ? row.object : "T1" };
}

const verb: Record<Answer, string> = {
  agree: "agrees with the AI",
  disagree: "disagrees with the AI",
  unsure: "is not sure",
};

type Anonymous = { raw: Answer; reason: string | null };

export function adjudicatorWhy(a: Anonymous, b: Anonymous) {
  const second = (answer: Anonymous) => answer.reason === "Need a second look";
  if (second(a) || second(b)) {
    return `One reviewer asked for a second look, the other ${verb[second(a) ? b.raw : a.raw]}`;
  }
  if (a.raw === b.raw) {
    return a.raw === "disagree"
      ? "Both reviewers disagree with the AI"
      : a.raw === "agree"
        ? "Both reviewers agree with the AI"
        : "Neither reviewer is sure";
  }
  return `One reviewer ${verb[a.raw]}, the other ${verb[b.raw]}`;
}
