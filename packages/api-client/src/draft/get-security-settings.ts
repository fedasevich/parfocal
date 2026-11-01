import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const securitySettingSchema = z.object({
  key: z.string(),
  label: z.string(),
  detail: z.string(),
  on: z.boolean(),
  locked: z.boolean(),
});

export type SecuritySetting = z.infer<typeof securitySettingSchema>;

export const securitySettingsSchema = z.object({
  sign_in: z.array(securitySettingSchema),
  data: z.array(securitySettingSchema),
  two_factor: z.object({
    people: z.number().int().nonnegative(),
    of: z.number().int().nonnegative(),
  }),
});

export type SecuritySettings = z.infer<typeof securitySettingsSchema>;

export const getGetSecuritySettingsUrl = () => "/api/tenant/security";

const draft = defineDraftQuery(
  "getSecuritySettings",
  getGetSecuritySettingsUrl,
  securitySettingsSchema,
);

export type getSecuritySettingsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetSecuritySettingsQueryResult = getSecuritySettingsResponse;
export type GetSecuritySettingsQueryError = Problem;

export const getSecuritySettings = (options?: DraftRequest) => draft.fetcher([], options);

export const getGetSecuritySettingsQueryKey = () => draft.queryKey();

export const getGetSecuritySettingsQueryOptions = <
  TData = getSecuritySettingsResponse,
  TError = Problem,
>(
  options?: DraftQueryOptions<getSecuritySettingsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useGetSecuritySettings = <TData = getSecuritySettingsResponse, TError = Problem>(
  options?: DraftQueryOptions<getSecuritySettingsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
