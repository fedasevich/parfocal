export type InspectorTemplate = "none" | "sentinel-node" | "cell-review";

export type InspectorTabName = "objects" | "display" | "comments" | "opinion";

export type InspectorCounts = Record<InspectorTabName, number>;

export const inspectorTabLabels: Record<InspectorTabName, string> = {
  objects: "Objects",
  display: "Display",
  comments: "Comments",
  opinion: "Opinion",
};

export const inspectorTabOrder: readonly InspectorTabName[] = [
  "objects",
  "display",
  "comments",
  "opinion",
];

const templateNames: Record<InspectorTemplate, string> = {
  none: "No analysis template",
  "sentinel-node": "Sentinel node staging",
  "cell-review": "Cell review",
};

export const templateName = (template: InspectorTemplate) => templateNames[template];

export type InspectorSources = {
  objects: number;
  resultSets: number;
  threads: readonly { resolved: boolean }[];
  questions: readonly { answered: boolean }[];
};

export function inspectorCounts({
  objects,
  resultSets,
  threads,
  questions,
}: InspectorSources): InspectorCounts {
  return {
    objects,
    display: resultSets,
    comments: threads.filter((thread) => !thread.resolved).length,
    opinion: questions.filter((question) => !question.answered).length,
  };
}
