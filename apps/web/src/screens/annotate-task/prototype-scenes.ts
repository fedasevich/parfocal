import { linkOptions } from "@tanstack/react-router";
import { taskScenes } from "./scene-list.ts";

export const annotateStepperScenes = [
  {
    key: "kind",
    label: "Kind and presets",
    note: "Annotate is picked and the five presets are listed",
    search: { step: "kind", preset: "run" },
  },
  {
    key: "check-run",
    label: "What to check · whole-slide run",
    note: "Scope, order, sign-off rule and export filled in by the preset",
    search: { step: "check", preset: "run" },
  },
  {
    key: "check-sample",
    label: "What to check · a sample",
    note: "A random sample, the rest stays out of the export",
    search: { step: "check", preset: "sample" },
  },
  {
    key: "check-hand",
    label: "What to check · by hand",
    note: "No result set, so the check options are off",
    search: { step: "check", preset: "hand" },
  },
  {
    key: "how",
    label: "How it runs · blind first",
    note: "The switch that keeps first opinions independent",
    search: { step: "how", preset: "run" },
  },
  {
    key: "send",
    label: "Send",
    note: "Every choice summed up with a Change link",
    search: { step: "send", preset: "run" },
  },
] as const;

export function annotateTaskPrototypeLinks(projectId: string, taskId: string, slideId: string) {
  const params = { projectId, slideId };
  return [
    ...taskScenes.map(({ scene, label, note }) => ({
      key: `annotate-task-${scene}`,
      label: `Annotate task · ${label}`,
      note,
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId/annotate-task",
        params,
        search: { task: taskId, scene },
      }),
    })),
    ...annotateStepperScenes.map(({ key, label, note, search }) => ({
      key: `new-annotate-${key}`,
      label: `New annotate task · ${label}`,
      note,
      link: linkOptions({
        to: "/projects/$projectId/tasks/new-annotate",
        params: { projectId },
        search,
      }),
    })),
  ];
}
