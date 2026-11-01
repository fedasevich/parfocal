import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const projectSlideSchema = z.object({
  id: z.string(),
  label: z.string(),
  stain: z.string(),
  case: z.object({ id: z.string(), label: z.string(), specimen: z.string() }).nullable(),
  result_set_ids: z.array(z.string()),
});

export type ProjectSlide = z.infer<typeof projectSlideSchema>;

export const getListProjectSlidesUrl = (projectId: string) => `/api/projects/${projectId}/slides`;

const draft = defineDraftQuery(
  "listProjectSlides",
  getListProjectSlidesUrl,
  z.array(projectSlideSchema),
);

export type listProjectSlidesResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListProjectSlidesQueryResult = listProjectSlidesResponse;
export type ListProjectSlidesQueryError = Problem;

export const listProjectSlides = (projectId: string, options?: DraftRequest) =>
  draft.fetcher([projectId], options);

export const getListProjectSlidesQueryKey = (projectId: string) => draft.queryKey(projectId);

export const getListProjectSlidesQueryOptions = <
  TData = listProjectSlidesResponse,
  TError = Problem,
>(
  projectId: string,
  options?: DraftQueryOptions<listProjectSlidesResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([projectId], options);

export const useListProjectSlides = <TData = listProjectSlidesResponse, TError = Problem>(
  projectId: string,
  options?: DraftQueryOptions<listProjectSlidesResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([projectId], options, queryClient);
