import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const signInOptionsSchema = z.object({
  workspace: z.object({
    id: z.string(),
    name: z.string(),
    logo: z.string(),
    colour: z.string(),
  }),
  email: z.string(),
  institutions: z.array(
    z.object({
      workspace_id: z.string(),
      name: z.string(),
      short_name: z.string(),
      logo: z.string(),
      colour: z.string(),
      protocol: z.string(),
      domain: z.string(),
      matches_email: z.boolean(),
    }),
  ),
  methods: z.object({
    sso: z.boolean(),
    password: z.boolean(),
    link: z.boolean(),
    passkey: z.boolean(),
  }),
  link_minutes: z.number().int().positive(),
  idle_lock_minutes: z.number().int().positive(),
  session_hours: z.number().int().positive(),
  deep_link: z
    .object({
      path: z.string(),
      task_id: z.string().nullable(),
      task_code: z.string().nullable(),
      project_id: z.string(),
      slide_id: z.string(),
      slide_label: z.string(),
      case_label: z.string(),
    })
    .nullable(),
  last_decision: z.string().nullable(),
});

export type SignInOptions = z.infer<typeof signInOptionsSchema>;

export const getGetSignInOptionsUrl = (returnTo: string | null = null) =>
  returnTo === null
    ? "/api/auth/sign-in-options"
    : `/api/auth/sign-in-options?${new URLSearchParams({ return_to: returnTo }).toString()}`;

const draft = defineDraftQuery("getSignInOptions", getGetSignInOptionsUrl, signInOptionsSchema);

export type getSignInOptionsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetSignInOptionsQueryResult = getSignInOptionsResponse;
export type GetSignInOptionsQueryError = Problem;

export const getSignInOptions = (returnTo: string | null = null, options?: DraftRequest) =>
  draft.fetcher([returnTo], options);

export const getGetSignInOptionsQueryKey = (returnTo: string | null = null) =>
  draft.queryKey(returnTo);

export const getGetSignInOptionsQueryOptions = <TData = getSignInOptionsResponse, TError = Problem>(
  returnTo: string | null = null,
  options?: DraftQueryOptions<getSignInOptionsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([returnTo], options);

export const useGetSignInOptions = <TData = getSignInOptionsResponse, TError = Problem>(
  returnTo: string | null = null,
  options?: DraftQueryOptions<getSignInOptionsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([returnTo], options, queryClient);
