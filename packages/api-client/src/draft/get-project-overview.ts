import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const projectOverviewSchema = z.object({
  project_id: z.string(),
  cases: z.number().int().nonnegative(),
  slides: z.number().int().nonnegative(),
  result_sets: z.number().int().nonnegative(),
  objects: z.number().int().nonnegative(),
  reviewed_percent: z.number().min(0).max(100),
  needs_review: z.number().int().nonnegative(),
  no_results: z.number().int().nonnegative(),
  case_groups: z.array(
    z.object({
      label: z.string(),
      specimen: z.string(),
      slide_count: z.number().int().nonnegative(),
    }),
  ),
  slide_files: z.array(
    z.object({
      slide_id: z.string(),
      file: z.string(),
      stain: z.string(),
      remote: z.string().nullable(),
    }),
  ),
  study_template_id: z.string().nullable(),
  storage: z.object({
    used_gb: z.number().nonnegative(),
    allowance_gb: z.number().positive().nullable(),
  }),
  import_failure: z
    .object({
      file: z.string(),
      slide_label: z.string(),
      objects: z.number().int().positive(),
      reason: z.string(),
    })
    .nullable(),
});

export type ProjectOverview = z.infer<typeof projectOverviewSchema>;

export const getGetProjectOverviewUrl = (projectId: string) =>
  `/api/projects/${projectId}/overview`;

const draft = defineDraftQuery(
  "getProjectOverview",
  getGetProjectOverviewUrl,
  projectOverviewSchema,
);

export type getProjectOverviewResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetProjectOverviewQueryResult = getProjectOverviewResponse;
export type GetProjectOverviewQueryError = Problem;

export const getProjectOverview = (projectId: string, options?: DraftRequest) =>
  draft.fetcher([projectId], options);

export const getGetProjectOverviewQueryKey = (projectId: string) => draft.queryKey(projectId);

export const getGetProjectOverviewQueryOptions = <
  TData = getProjectOverviewResponse,
  TError = Problem,
>(
  projectId: string,
  options?: DraftQueryOptions<getProjectOverviewResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([projectId], options);

export const useGetProjectOverview = <TData = getProjectOverviewResponse, TError = Problem>(
  projectId: string,
  options?: DraftQueryOptions<getProjectOverviewResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([projectId], options, queryClient);
