import {
  type DataTag,
  type QueryClient,
  type QueryFunction,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { z } from "zod";
import { type ApiResponse, apiFetch } from "../fetcher.ts";
import { JobStatus, type Problem } from "../generated/api.ts";
import { draftMeta, withQueryKey } from "./support.ts";

export const MyJobKind = {
  upload: "upload",
  "model-run": "model-run",
  import: "import",
} as const;

export const myJobSchema = z.object({
  id: z.string(),
  kind: z.enum(MyJobKind),
  title: z.string(),
  project: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  status: z.enum(JobStatus),
  units_done: z.number().int().nonnegative(),
  units_total: z.number().int().nonnegative().nullable(),
  created_at: z.iso.datetime(),
  finished_at: z.iso.datetime().nullable(),
});

export type MyJob = z.infer<typeof myJobSchema>;

export type listMyJobsResponse = { data: MyJob[]; status: 200; headers: Headers };

export const getListMyJobsUrl = () => "/api/me/jobs";

export const listMyJobs = async (
  options?: Parameters<typeof apiFetch>[1],
): Promise<listMyJobsResponse> => {
  const response = await apiFetch<ApiResponse<unknown>>(getListMyJobsUrl(), {
    ...options,
    method: "GET",
  });
  return { ...response, status: 200, data: z.array(myJobSchema).parse(response.data) };
};

export const getListMyJobsQueryKey = () => ["/api/me/jobs"] as const;

type ListMyJobsOptions<TData, TError> = {
  query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof listMyJobs>>, TError, TData>>;
  request?: Parameters<typeof apiFetch>[1];
};

export const getListMyJobsQueryOptions = <
  TData = Awaited<ReturnType<typeof listMyJobs>>,
  TError = Problem,
>(
  options?: ListMyJobsOptions<TData, TError>,
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListMyJobsQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listMyJobs>>> = ({ signal }) =>
    listMyJobs({ signal, ...requestOptions });
  return { queryKey, queryFn, meta: draftMeta("listMyJobs"), ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listMyJobs>>,
    TError,
    TData
  > & { queryKey: DataTag<QueryKey, TData, TError> };
};

export type ListMyJobsQueryResult = NonNullable<Awaited<ReturnType<typeof listMyJobs>>>;
export type ListMyJobsQueryError = Problem;

export function useListMyJobs<TData = Awaited<ReturnType<typeof listMyJobs>>, TError = Problem>(
  options?: ListMyJobsOptions<TData, TError>,
  queryClient?: QueryClient,
): UseQueryResult<TData, TError> & { queryKey: DataTag<QueryKey, TData, TError> } {
  const queryOptions = getListMyJobsQueryOptions(options);
  const query = useQuery(queryOptions, queryClient);
  return withQueryKey(query, queryOptions.queryKey);
}
