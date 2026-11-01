import {
  type DataTag,
  type QueryClient,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import type { z } from "zod";
import { type ApiResponse, apiFetch } from "../fetcher.ts";
import type { Problem } from "../generated/api.ts";
import { draftMeta, withQueryKey } from "./support.ts";

export type DraftRequest = Parameters<typeof apiFetch>[1];

export type DraftResponse<Data> = { data: Data; status: 200; headers: Headers };

export type DraftQueryOptions<Response, TData, TError> = {
  query?: Partial<UseQueryOptions<Response, TError, TData>>;
  request?: DraftRequest;
};

export function defineDraftQuery<Args extends readonly unknown[], Schema extends z.ZodType>(
  operationId: string,
  url: (...args: Args) => string,
  schema: Schema,
) {
  type Response = DraftResponse<z.infer<Schema>>;

  const fetcher = async (args: Args, options?: DraftRequest): Promise<Response> => {
    const response = await apiFetch<ApiResponse<unknown>>(url(...args), {
      ...options,
      method: "GET",
    });
    return { ...response, status: 200, data: schema.parse(response.data) };
  };

  const queryKey = (...args: Args) => [url(...args)] as const;

  const queryOptions = <TData = Response, TError = Problem>(
    args: Args,
    options?: DraftQueryOptions<Response, TData, TError>,
  ) => {
    const { query, request } = options ?? {};
    return {
      queryKey: query?.queryKey ?? queryKey(...args),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetcher(args, { signal, ...request }),
      meta: draftMeta(operationId),
      ...query,
    } as UseQueryOptions<Response, TError, TData> & {
      queryKey: DataTag<QueryKey, TData, TError>;
    };
  };

  const useDraftQuery = <TData = Response, TError = Problem>(
    args: Args,
    options?: DraftQueryOptions<Response, TData, TError>,
    queryClient?: QueryClient,
  ): UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } => {
    const built = queryOptions(args, options);
    return withQueryKey(useQuery(built, queryClient), built.queryKey);
  };

  return { fetcher, queryKey, queryOptions, useDraftQuery };
}
