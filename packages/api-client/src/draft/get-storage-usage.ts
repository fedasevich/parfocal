import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const storageRuleSchema = z.object({
  key: z.string(),
  label: z.string(),
  detail: z.string(),
  on: z.boolean(),
  locked: z.boolean(),
});

export type StorageRule = z.infer<typeof storageRuleSchema>;

export const storageSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["s3", "dicomweb", "https", "azure"]),
  access: z.string(),
  address: z.string(),
  new_slides: z.enum(["copied", "in-place"]),
  health: z.enum(["answering", "expiring"]),
  first_tile_ms: z.number().int().nonnegative().nullable(),
  expires_in_days: z.number().int().nonnegative().nullable(),
});

export type StorageSource = z.infer<typeof storageSourceSchema>;

export const storageUsageSchema = z.object({
  total_tb: z.number().nonnegative(),
  in_place_tb: z.number().nonnegative(),
  parts: z.array(z.object({ kind: z.string(), label: z.string(), tb: z.number().nonnegative() })),
  by_project: z.array(
    z.object({
      project: z.object({ id: z.string(), code: z.string(), name: z.string() }),
      colour: z.number().int().nonnegative(),
      gb: z.number().nonnegative(),
      cap_gb: z.number().nonnegative().nullable(),
    }),
  ),
  rules: z.array(storageRuleSchema),
  sources: z.array(storageSourceSchema),
});

export type StorageUsage = z.infer<typeof storageUsageSchema>;

export const getGetStorageUsageUrl = () => "/api/tenant/storage";

const draft = defineDraftQuery("getStorageUsage", getGetStorageUsageUrl, storageUsageSchema);

export type getStorageUsageResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetStorageUsageQueryResult = getStorageUsageResponse;
export type GetStorageUsageQueryError = Problem;

export const getStorageUsage = (options?: DraftRequest) => draft.fetcher([], options);

export const getGetStorageUsageQueryKey = () => draft.queryKey();

export const getGetStorageUsageQueryOptions = <TData = getStorageUsageResponse, TError = Problem>(
  options?: DraftQueryOptions<getStorageUsageResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useGetStorageUsage = <TData = getStorageUsageResponse, TError = Problem>(
  options?: DraftQueryOptions<getStorageUsageResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
