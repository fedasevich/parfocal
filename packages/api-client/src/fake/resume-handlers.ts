import { HttpResponse, http, type RequestHandler } from "msw";
import type { ResumeChange, ResumeState } from "../generated/api.ts";
import { reviewTasks, slides } from "./scenario.ts";

const storageKey = "parfocal.fake.resume";

let memory: ResumeState | null = null;

function device(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function storedResume(): ResumeState | null {
  try {
    const stored = device()?.getItem(storageKey);
    if (stored === null || stored === undefined) return memory;
    return JSON.parse(stored) as ResumeState;
  } catch {
    return memory;
  }
}

function keep(state: ResumeState): void {
  memory = state;
  try {
    device()?.setItem(storageKey, JSON.stringify(state));
  } catch {
    return;
  }
}

export function resetFakeResume(): void {
  memory = null;
  try {
    device()?.removeItem(storageKey);
  } catch {
    return;
  }
}

const notFound = () =>
  HttpResponse.json(
    { type: "about:blank", title: "Task slide not found", status: 404, code: "not-found" },
    { status: 404, headers: { "content-type": "application/problem+json" } },
  );

export function resumeHandlers(): RequestHandler[] {
  return [
    http.put("*/api/me/resume", async ({ request }) => {
      const change = (await request.json()) as ResumeChange;
      const task = reviewTasks.find((candidate) => candidate.id === change.task_id);
      const slide = slides.find((candidate) => candidate.id === change.slide_id);
      if (task === undefined || slide === undefined || slide.project !== task.project)
        return notFound();
      const state: ResumeState = {
        task_id: change.task_id,
        slide_id: change.slide_id,
        mode: change.mode,
        object_id: change.object_id ?? null,
        camera: change.camera ?? null,
        updated_at: new Date().toISOString(),
      };
      keep(state);
      return HttpResponse.json(state);
    }),
  ];
}
