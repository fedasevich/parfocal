import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const projectScopeOptionsSchema = z.object({
  rois: z.array(z.object({ key: z.string(), name: z.string() })),
  unsure_zones: z.array(
    z.object({ key: z.string(), cells_per_slide: z.number().int().nonnegative() }),
  ),
});

export type ProjectScopeOptions = z.infer<typeof projectScopeOptionsSchema>;

export const getGetProjectScopeOptionsUrl = (projectId: string) =>
  `/api/projects/${projectId}/scope-options`;

const draft = defineDraftQuery(
  "getProjectScopeOptions",
  getGetProjectScopeOptionsUrl,
  projectScopeOptionsSchema,
);

export type getProjectScopeOptionsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetProjectScopeOptionsQueryResult = getProjectScopeOptionsResponse;
export type GetProjectScopeOptionsQueryError = Problem;

export const getProjectScopeOptions = (projectId: string, options?: DraftRequest) =>
  draft.fetcher([projectId], options);

export const getGetProjectScopeOptionsQueryKey = (projectId: string) => draft.queryKey(projectId);

export const getGetProjectScopeOptionsQueryOptions = <
  TData = getProjectScopeOptionsResponse,
  TError = Problem,
>(
  projectId: string,
  options?: DraftQueryOptions<getProjectScopeOptionsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([projectId], options);

export const useGetProjectScopeOptions = <TData = getProjectScopeOptionsResponse, TError = Problem>(
  projectId: string,
  options?: DraftQueryOptions<getProjectScopeOptionsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([projectId], options, queryClient);
