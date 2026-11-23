export const studyProjectPrefix = "Study ";

export const studyTaskNames = {
  review: "Study review",
  queue: "Study disagreement queue",
  annotate: "Study annotation",
} as const;

export const studySlideLabels = {
  review: "Study review 1",
  queue: "Study queue 1",
  annotate: "Study annotate",
} as const;

export type ParticipantProject = {
  projectId: string;
  reviewTask: string;
  reviewSlide: string;
  queueTask: string;
  queueSlide: string;
  annotateTask: string;
  annotateSlide: string;
};

export type ParticipantListing = {
  projects: { id: string; name: string }[];
  tasks: { id: string; name: string; projectId: string }[];
  slides: { id: string; label: string; project: { id: string } }[];
};

export const participantProjectName = (code: string): string =>
  `${studyProjectPrefix}${code.trim().toUpperCase()}`;

export function participantProjectOf(
  code: string,
  listing: ParticipantListing,
): ParticipantProject | undefined {
  const name = participantProjectName(code);
  const project = listing.projects.find((row) => row.name === name);
  if (project === undefined) return undefined;
  const task = (taskName: string) =>
    listing.tasks.find((row) => row.projectId === project.id && row.name === taskName)?.id;
  const slide = (label: string) =>
    listing.slides.find((row) => row.project.id === project.id && row.label === label)?.id;
  const reviewTask = task(studyTaskNames.review);
  const reviewSlide = slide(studySlideLabels.review);
  const queueTask = task(studyTaskNames.queue);
  const queueSlide = slide(studySlideLabels.queue);
  const annotateTask = task(studyTaskNames.annotate);
  const annotateSlide = slide(studySlideLabels.annotate);
  if (
    reviewTask === undefined ||
    reviewSlide === undefined ||
    queueTask === undefined ||
    queueSlide === undefined ||
    annotateTask === undefined ||
    annotateSlide === undefined
  ) {
    return undefined;
  }
  return {
    projectId: project.id,
    reviewTask,
    reviewSlide,
    queueTask,
    queueSlide,
    annotateTask,
    annotateSlide,
  };
}

export const participantTokens = (
  participant: ParticipantProject | null | undefined,
): Record<string, string | undefined> =>
  participant == null
    ? {}
    : {
        studyProject: participant.projectId,
        reviewTask: participant.reviewTask,
        reviewSlide: participant.reviewSlide,
        queueTask: participant.queueTask,
        queueSlide: participant.queueSlide,
        annotateTask: participant.annotateTask,
        annotateSlide: participant.annotateSlide,
      };
