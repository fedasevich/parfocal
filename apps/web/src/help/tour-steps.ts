import { destinations } from "../shell/destinations.ts";

export type TourContext = { projectId: string | undefined; taskId: string | undefined };

export type TourStep = {
  id: string;
  title: string;
  text: string;
  target?: string;
  route: (context: TourContext) => string | undefined;
};

export const tourSteps: readonly TourStep[] = [
  {
    id: "home",
    title: "Home",
    text: "Home puts your next job first. Reviewers see the task to continue, researchers see their projects and what to start.",
    target: '[data-slot="sidebar"] a[href="/"]',
    route: () => destinations.home(),
  },
  {
    id: "upload",
    title: "Upload",
    text: "Drop slides, results or a whole folder on one page. Files are grouped by case and slide, each result sits under the slide it matched, and every problem comes with its fix.",
    route: ({ projectId }) => (projectId ? destinations.upload(projectId) : undefined),
  },
  {
    id: "run-model",
    title: "Run a model",
    text: "Slides that came without results can be sent to a model. Choose the model, see how long it takes, and run it. The run shows in the jobs tray.",
    route: ({ projectId }) => (projectId ? destinations.runModel(projectId) : undefined),
  },
  {
    id: "new-task",
    title: "New review task",
    text: "From a project, hand slides to reviewers as a review task in a few short steps. Pick the slides, the reviewers, what to review and the rules, then send it.",
    route: ({ projectId }) => (projectId ? destinations.newReviewTask(projectId) : undefined),
  },
  {
    id: "team",
    title: "Watching progress",
    text: "Team shows every open task and how far each reviewer is. Nudge anyone who is behind.",
    target: '[data-slot="sidebar"] a[href="/team"]',
    route: () => destinations.team(),
  },
  {
    id: "review",
    title: "Review",
    text: "Guided review shows one object at a time. Agree with K, disagree with X, say what is wrong, and submit when nothing blocks the slide.",
    route: ({ taskId }) => (taskId ? destinations.guided(taskId) : destinations.myWork()),
  },
  {
    id: "disagreements",
    title: "Disagreements",
    text: "When reviewers submit, their differences are listed side by side with the AI. Decide each one, or send some to an adjudicator for a second opinion.",
    route: ({ taskId }) => (taskId ? destinations.disagreements(taskId) : undefined),
  },
  {
    id: "sign-off",
    title: "Sign-off",
    text: "Sign-off lists what still blocks it, each with a link that takes you there. When everything is in, sign the evaluation.",
    route: ({ taskId }) => (taskId ? destinations.signOff(taskId) : undefined),
  },
  {
    id: "report",
    title: "The report",
    text: "The signed evaluation is shown as pages laid out by the study template. Preview the PDF, download it and see any later change in the log.",
    route: ({ taskId }) => (taskId ? destinations.evaluation(taskId) : undefined),
  },
  {
    id: "keys",
    title: "Keys and help",
    text: "Press ? for the shortcut sheet and change any key there. The account menu holds Help, where you can take this tour again.",
    target: '[aria-label="Account menu"]',
    route: () => destinations.settings("shortcuts"),
  },
];

export const tourLength = tourSteps.length;

export const tourDone = (progress: number): boolean => progress >= tourLength;

export const resumeIndex = (progress: number): number =>
  progress > 0 && !tourDone(progress) ? progress : 0;

export const offerShows = (saved: { progress: number }): boolean => saved.progress === 0;

export const progressAfterNext = (index: number, saved: number): number =>
  Math.max(saved, Math.min(index + 1, tourLength));

export const progressAfterStop = (index: number, saved: number): number =>
  tourDone(saved) ? saved : Math.max(saved, index);

export const isLastStep = (index: number): boolean => index >= tourLength - 1;

export const progressOf = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? Math.min(value, tourLength)
    : 0;
