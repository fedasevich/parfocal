import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

const toggled = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.object({ ...shape, on: z.boolean() });

export const projectImportsSchema = z.object({
  project_id: z.string(),
  watched_folder: toggled({
    address: z.string(),
    slides: z.string(),
    results: z.string(),
    every: z.string(),
  }),
  webhook: toggled({
    url: z.string(),
    secret_end: z.string(),
    abilities: z.array(z.object({ label: z.string(), on: z.boolean() })),
  }),
  events_out: toggled({
    endpoint: z.string(),
    last_call: z.number().int(),
    events: z.array(z.object({ name: z.string(), text: z.string(), on: z.boolean() })),
  }),
  token: z.object({ end: z.string() }),
  last_arrival: z.object({ at: z.string(), what: z.string() }).nullable(),
  arrivals: z.array(
    z.object({
      at: z.string(),
      event: z.string(),
      file: z.string(),
      code: z.number().int(),
      result: z.string(),
    }),
  ),
});

export type ProjectImports = z.infer<typeof projectImportsSchema>;

export const getGetProjectImportsUrl = (projectId: string) => `/api/projects/${projectId}/imports`;

const draft = defineDraftQuery("getProjectImports", getGetProjectImportsUrl, projectImportsSchema);

export type getProjectImportsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetProjectImportsQueryResult = getProjectImportsResponse;
export type GetProjectImportsQueryError = Problem;

export const getProjectImports = (projectId: string, options?: DraftRequest) =>
  draft.fetcher([projectId], options);

export const getGetProjectImportsQueryKey = (projectId: string) => draft.queryKey(projectId);

export const getGetProjectImportsQueryOptions = <
  TData = getProjectImportsResponse,
  TError = Problem,
>(
  projectId: string,
  options?: DraftQueryOptions<getProjectImportsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([projectId], options);

export const useGetProjectImports = <TData = getProjectImportsResponse, TError = Problem>(
  projectId: string,
  options?: DraftQueryOptions<getProjectImportsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([projectId], options, queryClient);
