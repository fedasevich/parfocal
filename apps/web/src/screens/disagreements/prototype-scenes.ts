import { linkOptions } from "@tanstack/react-router";
import { mockScenes } from "../scenes.ts";

const queueNotes: Record<(typeof mockScenes.disagree)[number], [string, string]> = {
  queue: ["Disagreements", "Daniel's queue of 7 objects in RT-14"],
  selected: ["Disagreements · three selected", "T4, T5 and T1·C145 checked"],
  sendadj: ["Disagreements · send to an adjudicator", "The Send to an adjudicator modal"],
  sent: ["Disagreements · with the adjudicator", "Three objects with Anna Kopecká"],
  adjudicate: ["Adjudication · first object", "Anna decides T4 with Reviewer A and B"],
  adjdone: ["Adjudication · all decided", "Anna has decided all three"],
  lockedqueue: ["Disagreements · locked", "Issue, the queue waits for Simona's last slides"],
  declined: ["Disagreements · declined", "Issue, Anna declined the three objects"],
  edited: ["Disagreements · edited", "Issue, T2 was redrawn after both reviewers decided"],
};

const signOffNotes: Record<(typeof mockScenes.signoff)[number], [string, string]> = {
  blocked: ["Sign-off · blockers", "Issue, reviews and disagreements still open"],
  ready: ["Sign-off · ready", "Ready to sign RT-14 with single sign-on"],
  ssofail: ["Sign-off · SSO failed", "Issue, Vltava single sign-on did not answer"],
  signed: ["Sign-off · signed", "Evaluation v1 signed, with a change after sign-off"],
  amend: ["Sign-off · amendment", "Issue, starting v2 needs a reason"],
};

const evaluationNotes: Record<(typeof mockScenes.evaluation)[number], [string, string]> = {
  report: ["Evaluation report", "RT-14's report as its pages"],
  arrange: ["Evaluation report · arrange", "Arranging blocks and format for this task"],
  pdf: ["Evaluation report · PDF", "The PDF preview with page thumbnails"],
  retiredtpl: ["Evaluation report · retired template", "Issue, the report keeps template v2"],
  exportfail: ["Evaluation report · export failed", "Issue, the PDF could not be made"],
};

export function disagreementPrototypeLinks(taskId: string) {
  const params = { taskId };
  return [
    ...mockScenes.disagree.map((scene) => ({
      key: `disagree-${scene}`,
      label: queueNotes[scene][0],
      note: queueNotes[scene][1],
      link: linkOptions({ to: "/tasks/$taskId/disagreements", params, search: { scene } }),
    })),
    ...mockScenes.signoff.map((scene) => ({
      key: `signoff-${scene}`,
      label: signOffNotes[scene][0],
      note: signOffNotes[scene][1],
      link: linkOptions({ to: "/tasks/$taskId/sign-off", params, search: { scene } }),
    })),
    ...mockScenes.evaluation.map((scene) => ({
      key: `evaluation-${scene}`,
      label: evaluationNotes[scene][0],
      note: evaluationNotes[scene][1],
      link: linkOptions({ to: "/tasks/$taskId/evaluation", params, search: { scene } }),
    })),
  ];
}
