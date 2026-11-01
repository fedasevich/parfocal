import type { DecisionStyle as StyleKind } from "@parfocal/ui/components/decision-buttons";
import type { SceneOf } from "../scenes.ts";
import type { Count } from "./decision-style.ts";

export type GuidedScene = SceneOf<"guided">;

export type GuidedTab = "review" | "comments" | "display";

export type GuidedIssue = "slidefail" | "noresults" | "withdrawn";

export type GuidedSetup = {
  focus: string;
  tab: GuidedTab;
  stage: "empty" | "review" | "done";
  done: boolean;
  disagreeOpen: boolean;
  style: StyleKind | null;
  issue: GuidedIssue | null;
  readOnly: boolean;
  connLost: boolean;
  submitFail: boolean;
  dropAnswers: string[];
  showSkipped: boolean;
  cellsPreview: boolean;
  whole: boolean;
  coach: boolean;
  confidenceLock: string | null;
  preset: string | null;
  commentDraft: string;
  noteDraft: { reasons: string[]; text: string } | null;
  pending: Count | null;
  answered: Record<string, Count>;
};

const base: GuidedSetup = {
  focus: "T5",
  tab: "review",
  stage: "review",
  done: false,
  disagreeOpen: false,
  style: null,
  issue: null,
  readOnly: false,
  connLost: false,
  submitFail: false,
  dropAnswers: [],
  showSkipped: false,
  cellsPreview: false,
  whole: false,
  coach: false,
  confidenceLock: null,
  preset: null,
  commentDraft: "",
  noteDraft: null,
  pending: null,
  answered: {},
};

const scenes: Record<GuidedScene, Partial<GuidedSetup>> = {
  first: { focus: "T1", stage: "empty", coach: true },
  region: {},
  disagree: { disagreeOpen: true, answered: { T5: "disagree" } },
  note: { focus: "T2" },
  comments: { focus: "T2", tab: "comments" },
  mention: { focus: "T2", tab: "comments", commentDraft: "Worth a CK level here? @Da" },
  grid: { focus: "first-open-cell" },
  cellrest: { focus: "first-open-cell", cellsPreview: true },
  cellwhole: { focus: "first-open-cell", whole: true },
  certainty: { style: "certainty" },
  yesno: { style: "yesno" },
  blind: { style: "blind" },
  display: { tab: "display" },
  locked: { tab: "display", confidenceLock: "Confidence hidden this round" },
  preset: { focus: "T2", tab: "display", preset: "Dots, no IDs" },
  done: { stage: "done", done: true },
  skipped: { done: true, showSkipped: true },
  required: { stage: "done", done: true, dropAnswers: ["acceptable"] },
  submitfail: { stage: "done", done: true, submitFail: true },
  connlost: {
    connLost: true,
    pending: "unsure",
    noteDraft: {
      reasons: ["Need a deeper level"],
      text: "Could be a fold at the cut edge. A deeper level would settle it.",
    },
  },
  slidefail: { issue: "slidefail" },
  noresults: { issue: "noresults" },
  withdrawn: { issue: "withdrawn" },
  signedoff: { readOnly: true },
};

export function guidedSetup(scene: GuidedScene | undefined): GuidedSetup {
  return { ...base, ...(scene ? scenes[scene] : {}) };
}

export const finishingAnswers: Record<string, Count> = {
  T5: "disagree",
  T2·C204: "disagree",
};
