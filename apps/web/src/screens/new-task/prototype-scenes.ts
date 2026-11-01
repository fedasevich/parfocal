import type { TaskScene } from "./model.ts";
import type { TaskModal } from "./new-task-screen.tsx";

export const newTaskPrototypeScenes: {
  scene: TaskScene;
  modal?: TaskModal;
  label: string;
  note: string;
}[] = [
  {
    scene: "slides",
    label: "New review task · Slides",
    note: "Step 1 with the study template and 12 slides",
  },
  {
    scene: "slides",
    modal: "addslides",
    label: "New review task · Add slides",
    note: "The small modal for single slides",
  },
  {
    scene: "reviewers",
    label: "New review task · Reviewers",
    note: "Step 2 with the two reviewers",
  },
  { scene: "find", label: "New review task · typing a name", note: "The token field open on k" },
  { scene: "check", label: "New review task · What to check", note: "Step 3 with the estimate" },
  {
    scene: "decision",
    label: "New review task · Counts as changed",
    note: "5-point certainty with agree from 5",
  },
  {
    scene: "check",
    modal: "dpreview",
    label: "New review task · Preview the question",
    note: "The card reviewers get for T2",
  },
  {
    scene: "how",
    label: "New review task · How it runs",
    note: "Step 4 with blinding and the due date",
  },
  {
    scene: "locks",
    label: "New review task · a lock with its reason",
    note: "Confidence locked for every reviewer",
  },
  { scene: "send", label: "New review task · Send", note: "Step 5 sums the task up" },
  { scene: "sent", label: "New review task · Sent", note: "RT-16 is out" },
  {
    scene: "noresult",
    label: "New review task · no result set",
    note: "Issue, the picked slides lack CAMELYON v1.0",
  },
  {
    scene: "pastdue",
    label: "New review task · due date in the past",
    note: "Issue on How it runs",
  },
  {
    scene: "away",
    label: "New review task · a reviewer is away",
    note: "Issue, one reviewer is away until 22 Oct",
  },
  {
    scene: "retiredtpl",
    label: "New review task · template retired",
    note: "Issue, pick another template",
  },
  { scene: "nobody", label: "New review task · nobody picked", note: "Issue, Next is disabled" },
];
