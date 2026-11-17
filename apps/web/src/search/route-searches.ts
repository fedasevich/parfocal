import type { SlideStorage, State } from "@parfocal/api-client";
import { z } from "zod";
import { taskScenes } from "../screens/annotate-task/scene-list.ts";
import { annotateStepKeys, presetKeys } from "../screens/annotate-task/step-keys.ts";
import { developerSectionKeys, rendererKeys } from "../screens/developer/developer-keys.ts";
import { statusChoices, storageChoices } from "../screens/my-work/slide-filters.ts";
import { adminModals, adminSections, onboardingScenes } from "../screens/onboarding/scenes.ts";
import { stayTools } from "../screens/review/review-rail.ts";
import { mockScenes } from "../screens/scenes.ts";
import { viewerTabs } from "../screens/viewer/viewer-scenes.ts";
import { searchScopes } from "../shell/search-hits.ts";
import { workspaces } from "../viewer/workspace.ts";
import { lenientSearch } from "./lenient-search.ts";

const annotateTaskSceneKeys = taskScenes.map((item) => item.scene) as [
  (typeof taskScenes)[number]["scene"],
  ...(typeof taskScenes)[number]["scene"][],
];

const searchScopeValues = searchScopes.map((scope) => scope.value) as [
  (typeof searchScopes)[number]["value"],
  ...(typeof searchScopes)[number]["value"][],
];

const viewerScenes = [
  ...mockScenes.case,
  ...mockScenes.layers,
  ...mockScenes.navigator,
  ...mockScenes.compare,
] as const;

export const inviteSearch = lenientSearch({
  token: z.string().min(1).optional(),
  scene: z.enum(onboardingScenes.invite).optional(),
});

export const adminSearch = lenientSearch({
  section: z.enum(adminSections).optional(),
  scene: z.enum(onboardingScenes.admin).optional(),
  modal: z.enum(adminModals).optional(),
  request: z.string().max(64).optional(),
});

export const developerSearch = lenientSearch({
  scene: z.enum(mockScenes.developer).optional(),
  section: z.enum(developerSectionKeys).optional(),
  renderer: z.enum(rendererKeys).optional(),
});

export const myWorkSearch = lenientSearch({
  tab: z.enum(["review", "assigned", "all"]).optional(),
  sel: z.string().optional(),
  q: z.string().optional(),
  project: z.string().optional(),
  status: z.enum(statusChoices.map((choice) => choice.value) as [State, ...State[]]).optional(),
  set: z.string().optional(),
  reviewer: z.string().optional(),
  storage: z
    .enum(storageChoices.map((choice) => choice.value) as [SlideStorage, ...SlideStorage[]])
    .optional(),
  scene: z.enum(["review", "preview", "anna", "assigned", "all", "allpreview"]).optional(),
});

export const clinicalReportSearch = lenientSearch({
  scene: z.enum(mockScenes.creport).optional(),
  step: z.enum(["findings", "staging", "text", "sign"]).optional(),
  modal: z.enum(["deposit", "sign", "amend"]).optional(),
});

export const homeSearch = lenientSearch({
  scene: z.enum(["launch", "new"]).optional(),
});

export const popoutSearch = lenientSearch({
  kind: z.enum(["minimap", "inspector"]).optional(),
  project: z.string().optional(),
  slide: z.string().optional(),
  task: z.string().optional(),
  scene: z.enum(viewerScenes).optional(),
  tab: z.enum(viewerTabs).optional(),
  object: z.string().optional(),
});

export const runModelSearch = lenientSearch({
  scene: z.enum(mockScenes.runmodel).optional(),
  slides: z.array(z.string()).optional(),
});

export const coSignSearch = lenientSearch({
  scene: z.enum(mockScenes.cosign).optional(),
});

export const slideSearch = lenientSearch({
  task: z.string().optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  z: z.number().min(0).max(20).optional(),
  object: z.string().optional(),
  with: z.string().optional(),
  scene: z.enum(viewerScenes).optional(),
  tool: z.enum(stayTools).optional(),
  across: z.string().optional(),
  focus: z.boolean().optional(),
  peek: z.boolean().optional(),
  tab: z.enum(viewerTabs).optional(),
  modal: z.enum(["preset"]).optional(),
  pagedCells: z.number().int().optional(),
});

export type SlideSearch = ReturnType<typeof slideSearch.read>;

export const projectSearch = lenientSearch({
  tab: z.enum(["slides", "results", "tasks", "report", "settings", "people"]).default("slides"),
  status: z.string().optional(),
  q: z.string().optional(),
  sets: z.string().optional(),
  modal: z.enum(["addcls"]).optional(),
  add: z.string().optional(),
  scene: z.enum(mockScenes.project).optional(),
});

export const newAnnotateSearch = lenientSearch({
  step: z.enum(annotateStepKeys).optional(),
  preset: z.enum(presetKeys).optional(),
});

export const annotateSearch = lenientSearch({
  task: z.string().optional(),
  scene: z.enum(mockScenes.annotate).optional(),
  tool: z.enum(["smart"]).optional(),
});

export const liveSearch = lenientSearch({
  task: z.string().optional(),
  workspace: z.enum(workspaces).optional(),
});

export const annotateTaskSearch = lenientSearch({
  task: z.string().optional(),
  scene: z.enum(annotateTaskSceneKeys).optional(),
});

export const newTaskSearch = lenientSearch({
  scene: z.enum(mockScenes.task).optional(),
  step: z.enum(["kind", "slides", "reviewers", "check", "how", "send", "sent"]).optional(),
  modal: z.enum(["addslides", "dpreview"]).optional(),
});

export const uploadSearch = lenientSearch({
  scene: z.enum(mockScenes.upload).optional(),
  flow: z.string().optional(),
  formats: z.enum(mockScenes.formats).optional(),
});

export const setupSearch = lenientSearch({
  step: z.enum(onboardingScenes.setup).optional(),
  scene: z.enum(onboardingScenes.setup).optional(),
});

export const settingsSearch = lenientSearch({
  scene: z.enum(mockScenes.settings).optional(),
  q: z.string().optional(),
});

export const searchPageSearch = lenientSearch({
  scope: z.enum(searchScopeValues).optional(),
});

export const cellsSearch = lenientSearch({
  slide: z.string().optional(),
  scene: z.enum(mockScenes.gallery).optional(),
});

export const commentsSearch = lenientSearch({
  slide: z.string().optional(),
  thread: z.string().optional(),
});

export const guidedSearch = lenientSearch({
  slide: z.string().optional(),
  object: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().positive().max(100).optional(),
  scene: z.enum(mockScenes.guided).optional(),
  submitted: z.boolean().optional(),
  tab: z.enum(["review", "comments", "display"]).optional(),
});

export const signOffSearch = lenientSearch({
  scene: z.enum(mockScenes.signoff).optional(),
});

export const signUpSearch = lenientSearch({
  scene: z.enum(onboardingScenes.signup).optional(),
});

export const disagreementsSearch = lenientSearch({
  scene: z.enum(mockScenes.disagree).optional(),
});

export const signInSearch = lenientSearch({
  scene: z.enum(onboardingScenes.signin).optional(),
  return_to: z.string().optional(),
  sso: z.literal("none").optional(),
});

export const teamSearch = lenientSearch({
  scene: z.enum(mockScenes.team).optional(),
  tab: z.enum(["open", "done"]).optional(),
  project: z.string().optional(),
  reviewer: z.string().optional(),
  task: z.string().optional(),
  focus: z.string().optional(),
});

export const worklistSearch = lenientSearch({
  rows: z.number().int().min(0).max(50_000).optional(),
  mode: z.enum(["virtual", "plain"]).optional(),
});

export const evaluationSearch = lenientSearch({
  scene: z.enum(mockScenes.evaluation).optional(),
});

export const submittedSearch = lenientSearch({
  slide: z.string().optional(),
});
export type ProjectSearch = ReturnType<typeof projectSearch.read>;
