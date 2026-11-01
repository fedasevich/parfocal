import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const adminOverviewSchema = z.object({
  people: z.number().int().nonnegative(),
  researchers: z.number().int().nonnegative(),
  reviewers: z.number().int().nonnegative(),
  with_admin_rights: z.number().int().nonnegative(),
  can_sign_out_user_ids: z.array(z.string()),
  projects: z.number().int().nonnegative(),
  invites_waiting: z.number().int().nonnegative(),
  models: z.number().int().nonnegative(),
  runs_now: z.number().int().nonnegative(),
  stored_tb: z.number().nonnegative(),
  capacity_tb: z.number().nonnegative(),
  in_place_tb: z.number().nonnegative(),
  webhook_calls_today: z.number().int().nonnegative(),
  webhook_rejected_today: z.number().int().nonnegative(),
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const getGetAdminOverviewUrl = () => "/api/tenant/overview";

const draft = defineDraftQuery("getAdminOverview", getGetAdminOverviewUrl, adminOverviewSchema);

export type getAdminOverviewResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetAdminOverviewQueryResult = getAdminOverviewResponse;
export type GetAdminOverviewQueryError = Problem;

export const getAdminOverview = (options?: DraftRequest) => draft.fetcher([], options);

export const getGetAdminOverviewQueryKey = () => draft.queryKey();

export const getGetAdminOverviewQueryOptions = <TData = getAdminOverviewResponse, TError = Problem>(
  options?: DraftQueryOptions<getAdminOverviewResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useGetAdminOverview = <TData = getAdminOverviewResponse, TError = Problem>(
  options?: DraftQueryOptions<getAdminOverviewResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
