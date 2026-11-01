import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const cosignRequestSchema = z.object({
  id: z.string(),
  from_user_id: z.string(),
  case_id: z.string().nullable(),
  case_label: z.string(),
  slide_id: z.string(),
  project: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  sent_at: z.iso.datetime({ offset: true }),
});

export type CosignRequest = z.infer<typeof cosignRequestSchema>;

export const getListMyCosignRequestsUrl = () => "/api/me/cosign-requests";

const draft = defineDraftQuery(
  "listMyCosignRequests",
  getListMyCosignRequestsUrl,
  z.array(cosignRequestSchema),
);

export type listMyCosignRequestsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListMyCosignRequestsQueryResult = listMyCosignRequestsResponse;
export type ListMyCosignRequestsQueryError = Problem;

export const listMyCosignRequests = (options?: DraftRequest) => draft.fetcher([], options);

export const getListMyCosignRequestsQueryKey = () => draft.queryKey();

export const getListMyCosignRequestsQueryOptions = <
  TData = listMyCosignRequestsResponse,
  TError = Problem,
>(
  options?: DraftQueryOptions<listMyCosignRequestsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useListMyCosignRequests = <TData = listMyCosignRequestsResponse, TError = Problem>(
  options?: DraftQueryOptions<listMyCosignRequestsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
