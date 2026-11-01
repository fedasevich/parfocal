import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const slideAiProgressSchema = z.object({
  slide_id: z.string(),
  state: z.enum(["running", "ready"]),
  steps: z.array(
    z.object({
      key: z.enum(["tissue", "regions", "cells"]),
      state: z.enum(["done", "running", "queued"]),
      percent: z.number().min(0).max(100),
      seconds: z.number().int().nonnegative().nullable(),
      fragments: z.number().int().nonnegative().nullable(),
    }),
  ),
  found: z.array(z.string()),
});

export type SlideAiProgress = z.infer<typeof slideAiProgressSchema>;

export const getGetSlideAiProgressUrl = (slideId: string) => `/api/slides/${slideId}/ai-progress`;

const draft = defineDraftQuery(
  "getSlideAiProgress",
  getGetSlideAiProgressUrl,
  slideAiProgressSchema,
);

export type getSlideAiProgressResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetSlideAiProgressQueryResult = getSlideAiProgressResponse;
export type GetSlideAiProgressQueryError = Problem;

export const getSlideAiProgress = (slideId: string, options?: DraftRequest) =>
  draft.fetcher([slideId], options);

export const getGetSlideAiProgressQueryKey = (slideId: string) => draft.queryKey(slideId);

export const getGetSlideAiProgressQueryOptions = <
  TData = getSlideAiProgressResponse,
  TError = Problem,
>(
  slideId: string,
  options?: DraftQueryOptions<getSlideAiProgressResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([slideId], options);

export const useGetSlideAiProgress = <TData = getSlideAiProgressResponse, TError = Problem>(
  slideId: string,
  options?: DraftQueryOptions<getSlideAiProgressResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([slideId], options, queryClient);
