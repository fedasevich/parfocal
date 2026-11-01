import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const joinableWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  logo: z.string(),
  colour: z.string(),
  domain: z.string(),
  members: z.number().int().nonnegative(),
  projects: z.number().int().nonnegative(),
  matches_email: z.boolean(),
});

export type JoinableWorkspace = z.infer<typeof joinableWorkspaceSchema>;

export const joinableWorkspaceListSchema = z.array(joinableWorkspaceSchema);

export const getListJoinableWorkspacesUrl = () => "/api/me/joinable-workspaces";

const draft = defineDraftQuery(
  "listJoinableWorkspaces",
  getListJoinableWorkspacesUrl,
  joinableWorkspaceListSchema,
);

export type listJoinableWorkspacesResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListJoinableWorkspacesQueryResult = listJoinableWorkspacesResponse;
export type ListJoinableWorkspacesQueryError = Problem;

export const listJoinableWorkspaces = (options?: DraftRequest) => draft.fetcher([], options);

export const getListJoinableWorkspacesQueryKey = () => draft.queryKey();

export const getListJoinableWorkspacesQueryOptions = <
  TData = listJoinableWorkspacesResponse,
  TError = Problem,
>(
  options?: DraftQueryOptions<listJoinableWorkspacesResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useListJoinableWorkspaces = <TData = listJoinableWorkspacesResponse, TError = Problem>(
  options?: DraftQueryOptions<listJoinableWorkspacesResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
