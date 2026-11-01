import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const modelTierSchema = z.object({
  job: z.enum(["tumor", "outline", "typer"]),
  tier: z.enum(["Best", "Good", "Fast"]),
  model: z.string(),
  description: z.string(),
  speed: z.number().int().min(1).max(3),
  runs_on: z.enum(["server", "browser"]),
});

export type ModelTier = z.infer<typeof modelTierSchema>;

export const modelTiersSchema = z.object({ tiers: z.array(modelTierSchema) });

export type ModelTiers = z.infer<typeof modelTiersSchema>;

export const getListModelTiersUrl = () => "/api/tenant/model-tiers";

const draft = defineDraftQuery("listModelTiers", getListModelTiersUrl, modelTiersSchema);

export type listModelTiersResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListModelTiersQueryResult = listModelTiersResponse;
export type ListModelTiersQueryError = Problem;

export const listModelTiers = (options?: DraftRequest) => draft.fetcher([], options);

export const getListModelTiersQueryKey = () => draft.queryKey();

export const getListModelTiersQueryOptions = <TData = listModelTiersResponse, TError = Problem>(
  options?: DraftQueryOptions<listModelTiersResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useListModelTiers = <TData = listModelTiersResponse, TError = Problem>(
  options?: DraftQueryOptions<listModelTiersResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
