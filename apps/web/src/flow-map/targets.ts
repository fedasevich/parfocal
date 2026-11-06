import { linkOptions } from "@tanstack/react-router";
import { type MockScreenWithScenes, mockScenes, type SceneOf } from "../screens/scenes.ts";
import type { PersonaKey } from "./review-flow.ts";
import type { WalkScreen } from "./walkthrough.ts";

export type ScenarioIds = {
  researchProject: string;
  clinicalProject: string;
  task: string;
  slide: string;
  clinicalSlide: string;
  clinicalCase: string;
};

export type TargetOptions = {
  scene?: string | undefined;
  clinical?: boolean;
  submitted?: boolean;
  as?: PersonaKey | undefined;
};

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
  const { scene, as } = options;
  const project = { projectId: ids.researchProject };
  const task = { taskId: ids.task };
  const clinicalSlide = { projectId: ids.clinicalProject, slideId: ids.clinicalSlide };
  switch (screen) {
    case "home":
      return linkOptions({ to: "/", search: { as } });
    case "project":
      return linkOptions({
        to: "/projects/$projectId",
        params: project,
        search: { scene: sceneIn("project", scene), as },
      });
    case "upload":
      return linkOptions({
        to: "/projects/$projectId/upload",
        params: project,
        search: { scene: sceneIn("upload", scene), as },
      });
    case "runmodel":
      return linkOptions({
        to: "/projects/$projectId/run-model",
        params: project,
        search: { scene: sceneIn("runmodel", scene), as },
      });
    case "task":
      return linkOptions({
        to: "/projects/$projectId/tasks/new",
        params: project,
        search: { scene: sceneIn("task", scene), as },
      });
    case "team":
      return linkOptions({ to: "/team", search: { scene: sceneIn("team", scene), as } });
    case "disagree":
      return linkOptions({
        to: "/tasks/$taskId/disagreements",
        params: task,
        search: { scene: sceneIn("disagree", scene), as },
      });
    case "signoff":
      return linkOptions({
        to: "/tasks/$taskId/sign-off",
        params: task,
        search: { scene: sceneIn("signoff", scene), as },
      });
    case "evaluation":
      return linkOptions({
        to: "/tasks/$taskId/evaluation",
        params: task,
        search: { scene: sceneIn("evaluation", scene), as },
      });
    case "worklist":
      return linkOptions({ to: "/my-work", search: { tab: myWorkTab(scene), as } });
    case "guided":
      return linkOptions({
        to: "/tasks/$taskId/guided",
        params: task,
        search: {
          slide: ids.slide,
          scene: sceneIn("guided", scene),
          submitted: options.submitted || undefined,
          as,
        },
      });
    case "case":
      return options.clinical
        ? linkOptions({
            to: "/projects/$projectId/slides/$slideId",
            params: clinicalSlide,
            search: { scene: sceneIn("case", scene), as },
          })
        : linkOptions({
            to: "/projects/$projectId/slides/$slideId",
            params: { projectId: ids.researchProject, slideId: ids.slide },
            search: { task: ids.task, scene: sceneIn("case", scene), as },
          });
    case "gallery":
      return linkOptions({
        to: "/tasks/$taskId/cells",
        params: task,
        search: { slide: ids.slide, scene: sceneIn("gallery", scene), as },
      });
    case "next":
      return linkOptions({
        to: "/tasks/$taskId/submitted",
        params: task,
        search: { slide: ids.slide, as },
      });
    case "creport":
      return linkOptions({
        to: "/projects/$projectId/cases/$caseId/report",
        params: { projectId: ids.clinicalProject, caseId: ids.clinicalCase },
        search: { scene: sceneIn("creport", scene), as },
      });
    case "cosign":
      return linkOptions({
        to: "/projects/$projectId/slides/$slideId/co-sign",
        params: clinicalSlide,
        search: { scene: sceneIn("cosign", scene), as },
      });
  }
}
