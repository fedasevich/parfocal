import type { RequestHandler } from "msw";
import { getGetMyChecklistMockHandler } from "../generated/api.msw.ts";
import type { Checklist } from "../generated/api.ts";
import { checklist, sampleProject } from "./scenario.ts";
import { fakeView } from "./view.ts";

export type DraftOperation = {
  operationId: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  handler: () => RequestHandler;
};

export const toChecklist = (): Checklist => ({
  hidden: !fakeView().firstWeek,
  steps: checklist.map((step) => ({ ...step, done: fakeView().firstWeek ? step.done : true })),
  sample_project: {
    id: sampleProject.id,
    code: sampleProject.code,
    name: sampleProject.name,
    slides: sampleProject.counts.slides,
  },
});

export const draftOperations: DraftOperation[] = [];

export const checklistHandlers = (): RequestHandler[] => [
  getGetMyChecklistMockHandler(() => toChecklist()),
];

export const draftHandlers = (): RequestHandler[] =>
  draftOperations.map((operation) => operation.handler());
