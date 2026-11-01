import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const reviewTaskDefaultsSchema = z.object({
  code: z.string(),
  task_id: z.string(),
  names: z.array(z.object({ result_set_id: z.string(), name: z.string() })),
  slide_ids: z.array(z.string()),
  result_set_id: z.string(),
  reviewer_ids: z.array(z.string()),
  due_on: z.iso.date(),
  reminder_days: z.array(z.number().int().positive()),
  study_template_id: z.string(),
  today: z.iso.date(),
});

export type ReviewTaskDefaults = z.infer<typeof reviewTaskDefaultsSchema>;

export const getGetReviewTaskDefaultsUrl = (projectId: string) =>
  `/api/projects/${projectId}/review-tasks/defaults`;

const draft = defineDraftQuery(
  "getReviewTaskDefaults",
  getGetReviewTaskDefaultsUrl,
  reviewTaskDefaultsSchema,
);

export type getReviewTaskDefaultsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetReviewTaskDefaultsQueryResult = getReviewTaskDefaultsResponse;
export type GetReviewTaskDefaultsQueryError = Problem;

export const getReviewTaskDefaults = (projectId: string, options?: DraftRequest) =>
  draft.fetcher([projectId], options);

export const getGetReviewTaskDefaultsQueryKey = (projectId: string) => draft.queryKey(projectId);

export const getGetReviewTaskDefaultsQueryOptions = <
  TData = getReviewTaskDefaultsResponse,
  TError = Problem,
>(
  projectId: string,
  options?: DraftQueryOptions<getReviewTaskDefaultsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([projectId], options);

export const useGetReviewTaskDefaults = <TData = getReviewTaskDefaultsResponse, TError = Problem>(
  projectId: string,
  options?: DraftQueryOptions<getReviewTaskDefaultsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([projectId], options, queryClient);
