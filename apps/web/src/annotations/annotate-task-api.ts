import {
  type AiObjectConfirm,
  type AiObjectEdit,
  type AnnotateSlideStatus,
  apiFetch,
  type CheckDraft,
  type LayerObject,
  listSharedAiObjects,
  type SharedAiObject,
  type SharedAiObjects,
  type SharedLayer,
} from "@parfocal/api-client";
import { useQuery } from "@tanstack/react-query";

export type { SharedAiObject };

const slidePath = (taskId: string, slideId: string) =>
  `/api/review-tasks/${taskId}/slides/${slideId}`;

const sharedLayerPath = (taskId: string, slideId: string) =>
  `${slidePath(taskId, slideId)}/shared-layer`;

type Answer<T> = { readonly data: T; readonly status: 200; readonly headers: Headers };

const send = <T>(url: string, method: string, body?: unknown) =>
  apiFetch<Answer<T>>(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });

export const readSharedLayer = (taskId: string, slideId: string) =>
  send<SharedLayer>(sharedLayerPath(taskId, slideId), "GET");

export const sharedLayerKey = (taskId: string, slideId: string) =>
  [sharedLayerPath(taskId, slideId)] as const;

export const useSharedLayer = (taskId: string, slideId: string) =>
  useQuery({
    queryKey: sharedLayerKey(taskId, slideId),
    queryFn: () => readSharedLayer(taskId, slideId),
  });

export const slideStatusKey = (taskId: string, slideId: string) =>
  [`${slidePath(taskId, slideId)}/check-status`] as const;

export const slideStatusQuery = (taskId: string, slideId: string) => ({
  queryKey: slideStatusKey(taskId, slideId),
  queryFn: () => send<AnnotateSlideStatus>(`${slidePath(taskId, slideId)}/check-status`, "GET"),
});

export const checkSlide = (taskId: string, slideId: string, draft: CheckDraft) =>
  send<AnnotateSlideStatus>(`${slidePath(taskId, slideId)}/check`, "POST", draft);

export const uncheckSlide = (taskId: string, slideId: string) =>
  send<AnnotateSlideStatus>(`${slidePath(taskId, slideId)}/uncheck`, "POST");

export const signOffSlide = (taskId: string, slideId: string) =>
  send<AnnotateSlideStatus>(`${slidePath(taskId, slideId)}/sign-off`, "POST");

export const confirmAi = (
  taskId: string,
  slideId: string,
  objectId: string,
  body: AiObjectConfirm,
) => send<LayerObject>(`${sharedLayerPath(taskId, slideId)}/ai/${objectId}/confirm`, "POST", body);

export const changeAi = (taskId: string, slideId: string, objectId: string, body: AiObjectEdit) =>
  send<LayerObject>(`${sharedLayerPath(taskId, slideId)}/ai/${objectId}`, "PUT", body);

const AI_PAGE = 5000;

async function aiPage(taskId: string, slideId: string, offset: number) {
  const answer = await listSharedAiObjects(taskId, slideId, { offset, limit: AI_PAGE });
  if (answer.status !== 200) throw new Error(answer.data.title);
  return answer;
}

export async function readSharedAiObjects(
  taskId: string,
  slideId: string,
): Promise<Answer<SharedAiObjects>> {
  const first = await aiPage(taskId, slideId, 0);
  const objects = [...first.data.objects];
  while (objects.length < first.data.total) {
    const page = await aiPage(taskId, slideId, objects.length);
    if (page.data.objects.length === 0) break;
    objects.push(...page.data.objects);
  }
  return { ...first, data: { ...first.data, objects } };
}

export const sharedAiObjectsKey = (taskId: string, slideId: string) =>
  [`${sharedLayerPath(taskId, slideId)}/ai`] as const;

export const useSharedAiObjects = (taskId: string, slideId: string, enabled: boolean) =>
  useQuery({
    queryKey: sharedAiObjectsKey(taskId, slideId),
    queryFn: () => readSharedAiObjects(taskId, slideId),
    enabled,
  });
