import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const sourceFileSchema = z.object({
  name: z.string(),
  detail: z.string(),
  size_gb: z.number().positive(),
  in_project: z.boolean(),
  result: z.object({ name: z.string(), detail: z.string() }).nullable(),
});

export const sourceListingSchema = z.object({
  address: z.string(),
  kind: z.enum(["link", "storage"]),
  files: z.array(sourceFileSchema),
});

export type SourceFile = z.infer<typeof sourceFileSchema>;
export type SourceListing = z.infer<typeof sourceListingSchema>;

export const getListSourceFilesUrl = (projectId: string, address: string) =>
  `/api/projects/${projectId}/source-files?address=${encodeURIComponent(address)}`;

const draft = defineDraftQuery("listSourceFiles", getListSourceFilesUrl, sourceListingSchema);

export type listSourceFilesResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListSourceFilesQueryResult = listSourceFilesResponse;
export type ListSourceFilesQueryError = Problem;

export const listSourceFiles = (projectId: string, address: string, options?: DraftRequest) =>
  draft.fetcher([projectId, address], options);

export const getListSourceFilesQueryKey = (projectId: string, address: string) =>
  draft.queryKey(projectId, address);

export const getListSourceFilesQueryOptions = <TData = listSourceFilesResponse, TError = Problem>(
  projectId: string,
  address: string,
  options?: DraftQueryOptions<listSourceFilesResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([projectId, address], options);

export const useListSourceFiles = <TData = listSourceFilesResponse, TError = Problem>(
  projectId: string,
  address: string,
  options?: DraftQueryOptions<listSourceFilesResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([projectId, address], options, queryClient);
