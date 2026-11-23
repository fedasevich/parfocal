import type { Project, ReviewTask, SlideRow } from "../generated/api.ts";
import { uuid } from "./scenario.ts";

export const fakeParticipantCode = "P-FAKE";
export const fakeParticipantRequester = "Dr. Jana Horáková, surgery";

const runKey = "parfocal.study.run";
const studyProjectId = uuid(3, 7);
const reviewTaskId = uuid(7, 14);
const annotateTaskId = uuid(7, 21);
const reviewSlideId = uuid(5, 1);
const cellSlideId = uuid(5, 1);
const annotateSlideId = uuid(5, 5);
export const fakeParticipantCaseLabel = "S26-04812";

const taskNames: [string, string][] = [
  ["Study review", reviewTaskId],
  ["Study disagreement queue", reviewTaskId],
  ["Study cell review", reviewTaskId],
  ["Study annotation", annotateTaskId],
];

const slideLabels: [string, string][] = [
  ["Study review 1", reviewSlideId],
  ["Study queue 1", cellSlideId],
  ["Study cells", cellSlideId],
  ["Study annotate", annotateSlideId],
];

export function fakeParticipantActive(): boolean {
  try {
    const raw = globalThis.sessionStorage?.getItem(runKey);
    if (raw == null) return false;
    return (JSON.parse(raw) as { code?: unknown }).code === fakeParticipantCode;
  } catch {
    return false;
  }
}

export const withParticipantProjectName = (project: Project): Project =>
  fakeParticipantActive() && project.id === studyProjectId
    ? { ...project, name: `Study ${fakeParticipantCode}` }
    : project;

export function withParticipantTasks(projectId: string, tasks: ReviewTask[]): ReviewTask[] {
  if (!fakeParticipantActive() || projectId !== studyProjectId) return tasks;
  const aliases = taskNames.flatMap(([name, id]) => {
    const found = tasks.find((task) => task.id === id);
    return found === undefined ? [] : [{ ...found, name }];
  });
  return [...tasks, ...aliases];
}

export function withParticipantSlides(
  rows: SlideRow[],
  rowOf: (slideId: string) => SlideRow,
): SlideRow[] {
  if (!fakeParticipantActive()) return rows;
  return [...rows, ...slideLabels.map(([label, id]) => ({ ...rowOf(id), label }))];
}

export const participantRequester = (caseLabel: string): string | null =>
  fakeParticipantActive() && caseLabel === fakeParticipantCaseLabel
    ? fakeParticipantRequester
    : null;
