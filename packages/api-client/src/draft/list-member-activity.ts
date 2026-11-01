import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const MemberAccountStatus = { active: "active", invited: "invited" } as const;

export const memberActivitySchema = z.object({
  user_id: z.string(),
  email: z.string(),
  status: z.enum(MemberAccountStatus),
  last_active_at: z.iso.datetime({ offset: true }).nullable(),
  project_codes: z.array(z.string()),
});

export type MemberActivity = z.infer<typeof memberActivitySchema>;

export const memberActivityListSchema = z.array(memberActivitySchema);

export const getListMemberActivityUrl = () => "/api/tenant/members/activity";

const draft = defineDraftQuery(
  "listMemberActivity",
  getListMemberActivityUrl,
  memberActivityListSchema,
);

export type listMemberActivityResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListMemberActivityQueryResult = listMemberActivityResponse;
export type ListMemberActivityQueryError = Problem;

export const listMemberActivity = (options?: DraftRequest) => draft.fetcher([], options);

export const getListMemberActivityQueryKey = () => draft.queryKey();

export const getListMemberActivityQueryOptions = <
  TData = listMemberActivityResponse,
  TError = Problem,
>(
  options?: DraftQueryOptions<listMemberActivityResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useListMemberActivity = <TData = listMemberActivityResponse, TError = Problem>(
  options?: DraftQueryOptions<listMemberActivityResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
