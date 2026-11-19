import { linkOptions } from "@tanstack/react-router";
import { mockScenes } from "../scenes.ts";

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
  retiredtpl: ["Evaluation report · retired template", "Issue, the report keeps template v2"],
  exportfail: ["Evaluation report · export failed", "Issue, the PDF could not be made"],
};

export function disagreementPrototypeLinks(taskId: string) {
  const params = { taskId };
  return [
    {
      key: "disagree-queue",
      label: "Disagreements",
      note: "The queue of objects the reviewers disagree on",
      link: linkOptions({ to: "/tasks/$taskId/disagreements", params }),
    },
    {
      key: "adjudicate",
      label: "Adjudication",
      note: "The objects a researcher sent to the signed-in person",
      link: linkOptions({ to: "/tasks/$taskId/adjudicate", params }),
    },
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
    {
      key: "evaluation-pdf",
      label: "Evaluation report · PDF",
      note: "The PDF preview with page thumbnails",
      link: linkOptions({ to: "/tasks/$taskId/evaluation", params, search: { view: "pdf" } }),
    },
  ];
}
