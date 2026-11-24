import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { TourSwitch } from "@parfocal/api-client";
import { moreChapters } from "./tour-chapters.ts";

export type TourAccount = TourSwitch["account"];

export const tourRoles = [
  "owner",
  "researcher",
  "reviewer-a",
  "reviewer-b",
  "adjudicator",
  "viewer",
  "annotator",
] as const satisfies readonly ("owner" | TourAccount)[];

export type TourRole = (typeof tourRoles)[number];

export type TourAdvance = { kind: "next" } | { kind: "click" } | { kind: "route"; pattern: RegExp };

export type TourStep = {
  route: string;
  anchor: string;
  text: MessageDescriptor;
  advance: TourAdvance;
  stay?: RegExp;
  gpu?: boolean;
  role?: TourRole;
};

export type TourChapter = {
  title: MessageDescriptor;
  role: TourRole;
  steps: TourStep[];
};

export type PlacedStep = TourStep & { chapter: number; role: TourRole; number: number };

const next: TourAdvance = { kind: "next" };
const click: TourAdvance = { kind: "click" };

const gallery = "{project:Scanner format comparison}";
const roleReview = "Role account review";
const guided = `/projects/{task_project:${roleReview}}/slides/{task_slide:${roleReview}|1}?task={task:${roleReview}}&mode=guided`;
const inGuided = /mode=guided|\/guided/;

export const baseChapters: TourChapter[] = [
  {
    title: msg`Upload and import`,
    role: "researcher",
    steps: [
      {
        route: "/",
        anchor: "top-upload",
        text: msg`Start with Upload. The same button sits in the top bar on every page. Press it.`,
        advance: click,
      },
      {
        route: `/projects/${gallery}/upload`,
        anchor: "upload-source",
        text: msg`Upload is a page with three steps, Files, Check and Upload. Files come from this computer or from a link or storage.`,
        advance: next,
      },
      {
        route: `/projects/${gallery}/upload`,
        anchor: "upload-drop",
        text: msg`Drop slides, AI results or a whole folder here, or press Choose files. The app pairs each result with its slide before anything is uploaded.`,
        advance: next,
      },
      {
        route: `/projects/${gallery}/upload`,
        anchor: "upload-formats",
        text: msg`What files work? shows the folder shape Parfocal understands and every scanner format it opens.`,
        advance: next,
      },
      {
        route: `/projects/${gallery}`,
        anchor: "project-upload",
        text: msg`Every project has its own Upload button. This is the format gallery, one slide of every supported format.`,
        advance: next,
      },
      {
        route: `/projects/${gallery}`,
        anchor: "project-new-task",
        text: msg`When the slides are in, New review task hands them to reviewers. The next chapter is the reviewer's side.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`Review as reviewer A`,
    role: "reviewer-a",
    steps: [
      {
        route: "/my-work",
        anchor: "my-work-tabs",
        text: msg`A reviewer finds all their work in My work. To review lists the tasks, Assigned by me what they handed out and All slides every slide they can see.`,
        advance: next,
      },
      {
        route: "/my-work",
        anchor: "my-work-task",
        text: msg`Each task shows its progress. Press the task to see where you are in it.`,
        advance: click,
      },
      {
        route: "/my-work",
        anchor: "preview-main",
        text: msg`Start in guided review opens the first object that needs you. Press it.`,
        advance: { kind: "route", pattern: /mode=guided|\/guided/ },
      },
      {
        route: guided,
        stay: inGuided,
        anchor: "decision-buttons",
        text: msg`Guided review shows one object at a time. Agree, Disagree or Not sure saves at once and moves to the next object. The keys are K, X and U.`,
        advance: next,
      },
      {
        route: guided,
        stay: inGuided,
        anchor: "mode-switch",
        text: msg`Switch from Guided to Review to scan the whole slide. Both ways save to the same review.`,
        advance: next,
      },
      {
        route: "/my-work?tab=all",
        anchor: "my-work-tabs",
        text: msg`All slides finds any slide again, with its state, not only the next one. That ends this chapter.`,
        advance: next,
      },
    ],
  },
];

export const tourChapters: TourChapter[] = [...baseChapters, ...moreChapters];

export const tourSteps: PlacedStep[] = tourChapters
  .flatMap((chapter, index) =>
    chapter.steps.map((step) => ({ ...step, chapter: index, role: step.role ?? chapter.role })),
  )
  .map((step, index) => ({ ...step, number: index + 1 }));

export const firstStepOf = (chapter: number) =>
  tourSteps.findIndex((step) => step.chapter === chapter);

export const roleAccountEmail = (account: TourAccount) => `role-${account}@parfocal.eu`;
