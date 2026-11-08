import {
  type AiObjectConfirm,
  type AiObjectEdit,
  type AnnotateSlideStatus,
  apiFetch,
  type CheckDraft,
  type DraftQueryOptions,
  defineDraftQuery,
  type LayerObject,
  type SharedLayer,
} from "@parfocal/api-client";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

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

const sharedAiObjectSchema = z.object({
  object: z.string(),
  kind: z.enum(["region", "cell"]),
  number: z.number().int().positive(),
  class_id: z.string().nullable(),
  score: z.number().min(0).max(1),
  geometry: z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }),
});

const sharedAiObjectsSchema = z.object({
  task_id: z.string(),
  slide_id: z.string(),
  result_set_id: z.string().nullable(),
  result_name: z.string().nullable(),
  objects: z.array(sharedAiObjectSchema),
});

export type SharedAiObject = z.infer<typeof sharedAiObjectSchema>;

const sharedAiDraft = defineDraftQuery(
  "listSharedAiObjects",
  (taskId: string, slideId: string) => `${sharedLayerPath(taskId, slideId)}/ai`,
  sharedAiObjectsSchema,
);

type SharedAiAnswer = Awaited<ReturnType<typeof sharedAiDraft.fetcher>>;

export const useSharedAiObjects = (
  taskId: string,
  slideId: string,
  options?: DraftQueryOptions<SharedAiAnswer, SharedAiAnswer, unknown>,
) => sharedAiDraft.useDraftQuery([taskId, slideId], options);
