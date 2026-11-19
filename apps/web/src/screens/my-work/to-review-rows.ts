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
  "whole-slide": "The whole slide",
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

export function startedResume(task: MyTask, resume: ResumeTarget | null): ResumeTarget | null {
  if (resume?.task_id !== task.id) return null;
  return task.slides_submitted > 0 || resume.decisions_on_slide > 0 ? resume : null;
}

export function continuePath(task: MyTask, resume: ResumeTarget | null): string {
  const here = startedResume(task, resume);
  if (here !== null) return destinations.guided(task.id, here.slide_id, here.object_id);
  return destinations.guided(task.id, task.next_slide_id);
}

export function heroTaskOf(active: MyTask[], resume: ResumeTarget | null): MyTask | undefined {
  return active.find((candidate) => startedResume(candidate, resume) !== null);
}

export function heroPath(active: MyTask[], resume: ResumeTarget | null): string | undefined {
  const task = heroTaskOf(active, resume);
  return task ? continuePath(task, resume) : undefined;
}

export function continuesHero(event: ListKey, sel: string | undefined, onRow = false): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return event.key === "Enter" && sel === undefined && !onRow;
}

export function reviewRow(
  task: MyTask,
  owner: string | undefined,
  resume: ResumeTarget | null,
): ReviewRowView | undefined {
  if (!activeTasks([task]).length) return undefined;
  const started = task.slides_submitted > 0 || startedResume(task, resume) !== null;
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
