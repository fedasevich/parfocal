import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const myAdjudicationSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  task_code: z.string(),
  task_name: z.string(),
  project: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  asked_by_user_id: z.string(),
  slide_id: z.string(),
  slide_label: z.string(),
  objects: z.array(z.string()),
  decided: z.number().int().nonnegative(),
  sent_at: z.iso.datetime({ offset: true }),
});

export type MyAdjudication = z.infer<typeof myAdjudicationSchema>;

export const getListMyAdjudicationsUrl = () => "/api/me/adjudications";

const draft = defineDraftQuery(
  "listMyAdjudications",
  getListMyAdjudicationsUrl,
  z.array(myAdjudicationSchema),
);

export type listMyAdjudicationsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListMyAdjudicationsQueryResult = listMyAdjudicationsResponse;
export type ListMyAdjudicationsQueryError = Problem;

export const listMyAdjudications = (options?: DraftRequest) => draft.fetcher([], options);

export const getListMyAdjudicationsQueryKey = () => draft.queryKey();

export const getListMyAdjudicationsQueryOptions = <
  TData = listMyAdjudicationsResponse,
  TError = Problem,
>(
  options?: DraftQueryOptions<listMyAdjudicationsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useListMyAdjudications = <TData = listMyAdjudicationsResponse, TError = Problem>(
  options?: DraftQueryOptions<listMyAdjudicationsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
