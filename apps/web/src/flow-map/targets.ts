import { linkOptions } from "@tanstack/react-router";
import { type MockScreenWithScenes, mockScenes, type SceneOf } from "../screens/scenes.ts";
import type { WalkScreen } from "./walkthrough.ts";

export type ScenarioIds = {
  researchProject: string;
  clinicalProject: string;
  task: string;
  slide: string;
  clinicalSlide: string;
};

export type TargetOptions = { scene?: string | undefined; clinical?: boolean; submitted?: boolean };

export function sceneIn<Screen extends MockScreenWithScenes>(
  screen: Screen,
  scene: string | undefined,
): SceneOf<Screen> | undefined {
  const known: readonly string[] = mockScenes[screen];
  return scene !== undefined && known.includes(scene) ? (scene as SceneOf<Screen>) : undefined;
}

const myWorkTab = (scene: string | undefined) =>
  scene === "assigned" ? "assigned" : scene === "all" || scene === "allpreview" ? "all" : "review";

export function targetFor(screen: WalkScreen, ids: ScenarioIds, options: TargetOptions = {}) {
  const { scene } = options;
  const project = { projectId: ids.researchProject };
  const task = { taskId: ids.task };
  const clinicalSlide = { projectId: ids.clinicalProject, slideId: ids.clinicalSlide };
  switch (screen) {
    case "home":
      return linkOptions({ to: "/" });
    case "project":
      return linkOptions({ to: "/projects/$projectId", params: project });
    case "upload":
      return linkOptions({
        to: "/projects/$projectId/upload",
        params: project,
        search: { scene: sceneIn("upload", scene) },
      });
    case "runmodel":
      return linkOptions({
        to: "/projects/$projectId/run-model",
        params: project,
        search: { scene: sceneIn("runmodel", scene) },
      });
    case "task":
      return linkOptions({
        to: "/projects/$projectId/tasks/new",
        params: project,
        search: { scene: sceneIn("task", scene) },
      });
    case "team":
      return linkOptions({ to: "/team", search: { scene: sceneIn("team", scene) } });
    case "disagree":
      return linkOptions({
        to: "/tasks/$taskId/disagreements",
        params: task,
        search: { scene: sceneIn("disagree", scene) },
      });
    case "signoff":
      return linkOptions({
        to: "/tasks/$taskId/sign-off",
        params: task,
        search: { scene: sceneIn("signoff", scene) },
      });
    case "evaluation":
      return linkOptions({
        to: "/tasks/$taskId/evaluation",
        params: task,
        search: { scene: sceneIn("evaluation", scene) },
      });
    case "worklist":
      return linkOptions({ to: "/my-work", search: { tab: myWorkTab(scene) } });
    case "guided":
      return linkOptions({
        to: "/tasks/$taskId/guided",
        params: task,
        search: {
          slide: ids.slide,
          scene: sceneIn("guided", scene),
          submitted: options.submitted || undefined,
        },
      });
    case "case":
      return options.clinical
        ? linkOptions({
            to: "/projects/$projectId/slides/$slideId",
            params: clinicalSlide,
            search: { scene: sceneIn("case", scene) },
          })
        : linkOptions({
            to: "/projects/$projectId/slides/$slideId",
            params: { projectId: ids.researchProject, slideId: ids.slide },
            search: { task: ids.task, scene: sceneIn("case", scene) },
          });
    case "gallery":
      return linkOptions({
        to: "/tasks/$taskId/cells",
        params: task,
        search: { slide: ids.slide, scene: sceneIn("gallery", scene) },
      });
    case "next":
      return linkOptions({
        to: "/tasks/$taskId/submitted",
        params: task,
        search: { slide: ids.slide },
      });
    case "creport":
      return linkOptions({
        to: "/projects/$projectId/slides/$slideId/report",
        params: clinicalSlide,
        search: { scene: sceneIn("creport", scene) },
      });
    case "cosign":
      return linkOptions({
        to: "/projects/$projectId/slides/$slideId/co-sign",
        params: clinicalSlide,
        search: { scene: sceneIn("cosign", scene) },
      });
  }
}
