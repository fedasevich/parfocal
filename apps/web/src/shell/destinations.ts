import type { SettingsSection } from "../screens/settings/section-keys.ts";
import type { ViewerMode } from "../viewer/viewer-mode.ts";
import { slideHref } from "./slide-link.ts";

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const destinations = {
  home: () => "/",
  myWork: () => "/my-work",
  notifications: () => "/notifications",
  search: (scope?: string) => `/search${query({ scope })}`,
  project: (projectId: string) => `/projects/${projectId}`,
  newProject: () => "/projects/new",
  upload: (projectId: string) => `/projects/${projectId}/upload`,
  runModel: (projectId: string) => `/projects/${projectId}/run-model`,
  newReviewTask: (projectId: string) => `/projects/${projectId}/tasks/new`,
  slide: (
    projectId: string,
    slideId: string,
    taskId?: string,
    object?: string,
    view: { x?: number | undefined; y?: number | undefined; z?: number | undefined } = {},
  ) => slideHref({ projectId, slideId, taskId, object, view }),
  focus: (projectId: string, slideId: string, taskId?: string) =>
    slideHref({ projectId, slideId, taskId, layout: "focus" }),
  compareSlides: (
    projectId: string,
    slideId: string,
    taskId: string | undefined,
    withSlideId?: string,
    mode?: ViewerMode,
  ) => slideHref({ projectId, slideId, taskId, mode, layout: "compare", withSlideId }),
  coSign: (projectId: string, caseId: string) => `/projects/${projectId}/cases/${caseId}/co-sign`,
  guided: (
    taskId: string,
    slideId?: string | null,
    objectId?: string | null,
    view: { x: number; y: number; z: number } | null = null,
  ) =>
    `/tasks/${taskId}/guided${query({
      slide: slideId ?? undefined,
      object: objectId ?? undefined,
      x: view?.x.toString(),
      y: view?.y.toString(),
      z: view?.z.toString(),
    })}`,
  disagreements: (taskId: string) => `/tasks/${taskId}/disagreements`,
  dataset: (taskId: string) => `/tasks/${taskId}/dataset`,
  adjudicate: (taskId: string) => `/tasks/${taskId}/adjudicate`,
  signOff: (taskId: string) => `/tasks/${taskId}/sign-off`,
  evaluation: (taskId: string) => `/tasks/${taskId}/evaluation`,
  team: (link: { scene?: string; task?: string; focus?: string | undefined } = {}) =>
    `/team${query({ scene: link.scene, task: link.task, focus: link.focus })}`,
  settings: (section: SettingsSection) => `/settings/${section}`,
  admin: () => "/admin",
  developer: (section?: string) => `/developer${query({ section })}`,
};
