import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const reviewerWorkloadSchema = z.object({
  user_id: z.string(),
  open_tasks: z.number().int().nonnegative(),
});

export type ReviewerWorkload = z.infer<typeof reviewerWorkloadSchema>;

export const getListReviewerWorkloadUrl = () => "/api/tenant/workload";

const draft = defineDraftQuery(
  "listReviewerWorkload",
  getListReviewerWorkloadUrl,
  z.array(reviewerWorkloadSchema),
);

export type listReviewerWorkloadResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListReviewerWorkloadQueryResult = listReviewerWorkloadResponse;
export type ListReviewerWorkloadQueryError = Problem;

export const listReviewerWorkload = (options?: DraftRequest) => draft.fetcher([], options);

export const getListReviewerWorkloadQueryKey = () => draft.queryKey();

export const getListReviewerWorkloadQueryOptions = <
  TData = listReviewerWorkloadResponse,
  TError = Problem,
>(
  options?: DraftQueryOptions<listReviewerWorkloadResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useListReviewerWorkload = <TData = listReviewerWorkloadResponse, TError = Problem>(
  options?: DraftQueryOptions<listReviewerWorkloadResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
