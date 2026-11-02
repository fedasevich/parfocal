import type { SettingsSection } from "../screens/settings/sections.ts";

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
  project: (projectId: string) => `/projects/${projectId}`,
  newProject: () => "/projects/new",
  upload: (projectId: string) => `/projects/${projectId}/upload`,
  runModel: (projectId: string) => `/projects/${projectId}/run-model`,
  newReviewTask: (projectId: string) => `/projects/${projectId}/tasks/new`,
  slide: (projectId: string, slideId: string, taskId?: string, object?: string) =>
    `/projects/${projectId}/slides/${slideId}${query({ task: taskId, object })}`,
  openSlide: (projectId: string, slideId: string, taskId?: string) =>
    `/projects/${projectId}/slides/${slideId}/live${query({ task: taskId })}`,
  coSign: (projectId: string, slideId: string) =>
    `/projects/${projectId}/slides/${slideId}/co-sign`,
  guided: (taskId: string, slideId?: string | null) =>
    `/tasks/${taskId}/guided${query({ slide: slideId ?? undefined })}`,
  disagreements: (taskId: string, scene?: string) =>
    `/tasks/${taskId}/disagreements${query({ scene })}`,
  signOff: (taskId: string) => `/tasks/${taskId}/sign-off`,
  evaluation: (taskId: string) => `/tasks/${taskId}/evaluation`,
  team: (link: { scene?: string; task?: string; focus?: string | undefined } = {}) =>
    `/team${query({ scene: link.scene, task: link.task, focus: link.focus })}`,
  settings: (section: SettingsSection) => `/settings/${section}`,
  admin: () => "/admin",
};
