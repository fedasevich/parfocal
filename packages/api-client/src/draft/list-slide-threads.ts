import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const slideThreadSchema = z.object({
  id: z.string(),
  slide_id: z.string(),
  task_id: z.string().nullable(),
  anchor: z.string(),
  replies: z.number().int().nonnegative(),
  resolved: z.boolean(),
});

export type SlideThread = z.infer<typeof slideThreadSchema>;

export const getListSlideThreadsUrl = (slideId: string) => `/api/slides/${slideId}/threads`;

const draft = defineDraftQuery(
  "listSlideThreads",
  getListSlideThreadsUrl,
  z.array(slideThreadSchema),
);

export type listSlideThreadsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListSlideThreadsQueryResult = listSlideThreadsResponse;
export type ListSlideThreadsQueryError = Problem;

export const listSlideThreads = (slideId: string, options?: DraftRequest) =>
  draft.fetcher([slideId], options);

export const getListSlideThreadsQueryKey = (slideId: string) => draft.queryKey(slideId);

export const getListSlideThreadsQueryOptions = <TData = listSlideThreadsResponse, TError = Problem>(
  slideId: string,
  options?: DraftQueryOptions<listSlideThreadsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([slideId], options);

export const useListSlideThreads = <TData = listSlideThreadsResponse, TError = Problem>(
  slideId: string,
  options?: DraftQueryOptions<listSlideThreadsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([slideId], options, queryClient);
