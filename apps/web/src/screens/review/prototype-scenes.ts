import { linkOptions } from "@tanstack/react-router";
import type { SceneOf } from "../scenes.ts";

const guidedScenes: { scene: SceneOf<"guided">; label: string; note: string }[] = [
  { scene: "first", label: "First time", note: "Four tips over T1, nothing decided yet" },
  { scene: "region", label: "A tumor region", note: "T5 with Agree, Disagree and Not sure" },
  { scene: "disagree", label: "After Disagree", note: "What is wrong, with optional fixes" },
  { scene: "note", label: "A saved note", note: "T2's note with an @mention" },
  { scene: "comments", label: "Comments on T2", note: "The thread in the Comments tab" },
  { scene: "mention", label: "A mention", note: "Writing a comment with the @ picker open" },
  { scene: "grid", label: "A cell", note: "T2·C204 with the floating cells panel" },
  { scene: "cellrest", label: "Agree with the rest", note: "The six open cells ringed" },
  { scene: "cellwhole", label: "Cells on the whole slide", note: "The cluster of sampled cells" },
  { scene: "certainty", label: "5-point certainty", note: "The certainty style with keys 1 to 5" },
  { scene: "yesno", label: "Yes or no", note: "The AI's claim hidden" },
  { scene: "blind", label: "Pick the class blind", note: "One key per class and Not sure" },
  { scene: "display", label: "Display", note: "The Display tab open" },
  { scene: "locked", label: "Display, locked", note: "Confidence locked by the task" },
  { scene: "preset", label: "Display, a preset", note: "Dots, no IDs picked" },
  { scene: "done", label: "Slide done", note: "Two required questions, then submit" },
  { scene: "skipped", label: "Issue · skipped objects", note: "T5 and six cells still open" },
  { scene: "required", label: "Issue · a required question", note: "Question 1 not answered" },
  { scene: "submitfail", label: "Issue · submit failed", note: "Try again, nothing is lost" },
  { scene: "connlost", label: "Issue · connection lost", note: "Not sure waits to be saved" },
  { scene: "slidefail", label: "Issue · slide fails to load", note: "Tiles missing at 20x" },
  { scene: "noresults", label: "Issue · no results", note: "tumor_052 has nothing to decide" },
  { scene: "withdrawn", label: "Issue · task withdrawn", note: "The decided slides are kept" },
  { scene: "signedoff", label: "Read-only after sign-off", note: "Changes need an amendment" },
];

const galleryScenes: { scene: SceneOf<"gallery">; label: string; note: string }[] = [
  { scene: "grid", label: "Cells on the slide", note: "The cells panel over the full viewer" },
  { scene: "rest", label: "Cells · agree with the rest", note: "Before it applies" },
  { scene: "folded", label: "Cells · folded", note: "The panel folded to one line" },
  { scene: "blind", label: "Cells · pick the class blind", note: "The class style in the viewer" },
];

export function reviewPrototypeLinks(taskId: string, slideId: string, emptySlideId?: string) {
  const task = { taskId };
  return [
    ...guidedScenes.map(({ scene, label, note }) => ({
      key: `guided-${scene}`,
      label: `Guided review · ${label}`,
      note,
      link: linkOptions({
        to: "/tasks/$taskId/guided",
        params: task,
        search: { slide: scene === "noresults" ? (emptySlideId ?? slideId) : slideId, scene },
      }),
    })),
    {
      key: "guided-reopen",
      label: "Guided review · reopened after submit",
      note: "The info banner after a submit",
      link: linkOptions({
        to: "/tasks/$taskId/guided",
        params: task,
        search: { slide: slideId, scene: "region", submitted: true },
      }),
    },
    {
      key: "next",
      label: "Submitted, then the next slide",
      note: "Slide 8 submitted, slide 9 opens by itself",
      link: linkOptions({
        to: "/tasks/$taskId/submitted",
        params: task,
        search: { slide: slideId },
      }),
    },
    ...galleryScenes.map(({ scene, label, note }) => ({
      key: `gallery-${scene}`,
      label,
      note,
      link: linkOptions({
        to: "/tasks/$taskId/cells",
        params: task,
        search: { slide: slideId, scene },
      }),
    })),
    {
      key: "comments",
      label: "Comments on IDs",
      note: "Threads on A1 with T2 open on the slide",
      link: linkOptions({
        to: "/tasks/$taskId/comments",
        params: task,
        search: { slide: slideId, thread: "T2" },
      }),
    },
  ];
}
