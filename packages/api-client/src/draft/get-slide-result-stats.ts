import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const slideResultStatsSchema = z.object({
  task_id: z.string(),
  slide_id: z.string(),
  object_count: z.number().int().nonnegative(),
  class_counts: z.array(z.object({ class_name: z.string(), count: z.number().int() })),
  score_bins: z.array(z.number().int().nonnegative()),
  ai_vs_reviewed: z.object({
    dice: z.number(),
    cells_agree_percent: z.number(),
    objects: z.array(
      z.object({
        object: z.string(),
        agreement: z.enum(["both", "ai_only", "reviewer_only"]),
      }),
    ),
  }),
  model_vs_model: z.object({
    set_a_id: z.string(),
    set_b_id: z.string(),
    dice: z.number(),
    only_in_a: z.array(z.string()),
  }),
  reviewers: z.object({
    user_ids: z.array(z.string()),
    kappa: z.number().nullable(),
    objects: z.array(
      z.object({ object: z.string(), agreement: z.enum(["same", "split", "unsure"]) }),
    ),
  }),
});

export type SlideResultStats = z.infer<typeof slideResultStatsSchema>;

export const getGetSlideResultStatsUrl = (taskId: string, slideId: string) =>
  `/api/review-tasks/${taskId}/slides/${slideId}/result-stats`;

const draft = defineDraftQuery(
  "getSlideResultStats",
  getGetSlideResultStatsUrl,
  slideResultStatsSchema,
);

export type getSlideResultStatsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetSlideResultStatsQueryResult = getSlideResultStatsResponse;
export type GetSlideResultStatsQueryError = Problem;

export const getSlideResultStats = (taskId: string, slideId: string, options?: DraftRequest) =>
  draft.fetcher([taskId, slideId], options);

export const getGetSlideResultStatsQueryKey = (taskId: string, slideId: string) =>
  draft.queryKey(taskId, slideId);

export const getGetSlideResultStatsQueryOptions = <
  TData = getSlideResultStatsResponse,
  TError = Problem,
>(
  taskId: string,
  slideId: string,
  options?: DraftQueryOptions<getSlideResultStatsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([taskId, slideId], options);

export const useGetSlideResultStats = <TData = getSlideResultStatsResponse, TError = Problem>(
  taskId: string,
  slideId: string,
  options?: DraftQueryOptions<getSlideResultStatsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([taskId, slideId], options, queryClient);
