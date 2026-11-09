import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const reviewObjectSchema = z.object({
  object: z.string(),
  kind: z.enum(["region", "cell"]),
  number: z.number().int().positive(),
  class_name: z.string(),
  score: z.number().min(0).max(1),
  size_mm: z.number().nonnegative().nullable(),
  other_class: z.string().nullable(),
  detector_score: z.number().min(0).max(1).nullable().optional(),
  foreground: z.number().min(0).max(1).nullable().optional(),
  outline: z.array(z.number()).min(6).nullable().optional(),
});

export const reviewObjectsSchema = z.object({
  task_id: z.string(),
  slide_id: z.string(),
  slide: z.object({
    label: z.string(),
    case_label: z.string().nullable(),
    stain: z.string(),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
  }),
  objects: z.array(reviewObjectSchema),
  added: z.array(z.object({ object: z.string(), note: z.string().nullable() })),
});

export type ReviewObject = z.infer<typeof reviewObjectSchema>;
export type ReviewObjects = z.infer<typeof reviewObjectsSchema>;

export const getListReviewObjectsUrl = (taskId: string, slideId: string) =>
  `/api/review-tasks/${taskId}/slides/${slideId}/objects`;

const draft = defineDraftQuery("listReviewObjects", getListReviewObjectsUrl, reviewObjectsSchema);

export type listReviewObjectsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListReviewObjectsQueryResult = listReviewObjectsResponse;
export type ListReviewObjectsQueryError = Problem;

export const listReviewObjects = (taskId: string, slideId: string, options?: DraftRequest) =>
  draft.fetcher([taskId, slideId], options);

export const getListReviewObjectsQueryKey = (taskId: string, slideId: string) =>
  draft.queryKey(taskId, slideId);

export const getListReviewObjectsQueryOptions = <
  TData = listReviewObjectsResponse,
  TError = Problem,
>(
  taskId: string,
  slideId: string,
  options?: DraftQueryOptions<listReviewObjectsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([taskId, slideId], options);

export const useListReviewObjects = <TData = listReviewObjectsResponse, TError = Problem>(
  taskId: string,
  slideId: string,
  options?: DraftQueryOptions<listReviewObjectsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([taskId, slideId], options, queryClient);
