import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

const share = z.number().min(0).max(1);

export const resultSetTyperSchema = z.object({
  result_set_id: z.string(),
  name: z.string(),
  calibrated: z.boolean(),
  checked_on_held_out: z.boolean(),
  band_accuracy: z.object({
    confident: share.optional(),
    likely: share.optional(),
    unsure: share.optional(),
    doubtful: share.optional(),
  }),
  test_set_accuracy: share.nullable(),
  test_set_confident_share: share.nullable(),
  test_set_unsure_share: share.nullable(),
  validated_sites: z.array(z.string()),
});

export type ResultSetTyper = z.infer<typeof resultSetTyperSchema>;

export const getGetResultSetTyperUrl = (resultSetId: string) =>
  `/api/result-sets/${resultSetId}/typer`;

const draft = defineDraftQuery("getResultSetTyper", getGetResultSetTyperUrl, resultSetTyperSchema);

export type getResultSetTyperResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetResultSetTyperQueryResult = getResultSetTyperResponse;
export type GetResultSetTyperQueryError = Problem;

export const getResultSetTyper = (resultSetId: string, options?: DraftRequest) =>
  draft.fetcher([resultSetId], options);

export const getGetResultSetTyperQueryKey = (resultSetId: string) => draft.queryKey(resultSetId);

export const getGetResultSetTyperQueryOptions = <
  TData = getResultSetTyperResponse,
  TError = Problem,
>(
  resultSetId: string,
  options?: DraftQueryOptions<getResultSetTyperResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([resultSetId], options);

export const useGetResultSetTyper = <TData = getResultSetTyperResponse, TError = Problem>(
  resultSetId: string,
  options?: DraftQueryOptions<getResultSetTyperResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([resultSetId], options, queryClient);
