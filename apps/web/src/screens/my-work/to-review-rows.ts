import type { MyTask, ResumeTarget, TaskScope } from "@parfocal/api-client";
import { destinations } from "../../shell/destinations.ts";
import { formatDue, percent } from "../format.ts";
import type { ListKey } from "./list-keys.ts";

export const scopeWords: Record<TaskScope, string> = {
  "all-regions": "Tumor regions: all",
  "random-cells": "A random sample of cells",
  "cells-below-score": "Cells the model was least sure about",
  "inside-rois": "Only inside ROIs",
  "unsure-zones": "Unsure zones only",
};

export type ReviewTag = { label: string; tone: "neutral" | "accent" | "warn" };

export type ReviewRowView = {
  title: string;
  sub: string;
  progress: { value: number; label: string };
  tags: ReviewTag[];
  action: { label: "Continue" | "Start"; primary: boolean; path: string };
};

export function activeTasks(tasks: MyTask[]) {
  return tasks.filter((task) => task.status === "in-review" || task.status === "not-started");
}

export function continuePath(task: MyTask, resume: ResumeTarget | null): string {
  if (resume?.task_id === task.id) {
    return destinations.guided(task.id, resume.slide_id, resume.object_id);
  }
  return destinations.guided(task.id, task.next_slide_id);
}

export function heroPath(active: MyTask[], resume: ResumeTarget | null): string | undefined {
  const task = resume ? active.find((candidate) => candidate.id === resume.task_id) : undefined;
  return task ? continuePath(task, resume) : undefined;
}

export function continuesHero(event: ListKey, sel: string | undefined): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return event.key === "Enter" && sel === undefined;
}

export function reviewRow(
  task: MyTask,
  owner: string | undefined,
  resume: ResumeTarget | null,
): ReviewRowView | undefined {
  if (!activeTasks([task]).length) return undefined;
  const started = task.slides_submitted > 0;
  const sub = [
    task.project.name,
    scopeWords[task.scope],
    ...(task.due_on ? [`due ${formatDue(task.due_on)}`] : []),
  ].join(" · ");
  return {
    title: task.name,
    sub,
    progress: {
      value: percent(task.slides_submitted, task.slides_assigned),
      label: `${task.slides_submitted} of ${task.slides_assigned} slides`,
    },
    tags: [
      ...(task.blinded ? [{ label: "Blind", tone: "neutral" as const }] : []),
      started
        ? { label: "In progress", tone: "accent" }
        : { label: `New from ${owner ?? "the researcher"}`, tone: "warn" },
    ],
    action: {
      label: started ? "Continue" : "Start",
      primary: !started,
      path: continuePath(task, resume),
    },
  };
}
