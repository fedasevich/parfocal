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
      task_id: z.string(),
      task_code: z.string(),
      project_id: z.string(),
      slide_id: z.string(),
      slide_label: z.string(),
      case_label: z.string(),
    })
    .nullable(),
  last_decision: z.string().nullable(),
});

export type SignInOptions = z.infer<typeof signInOptionsSchema>;

export const getGetSignInOptionsUrl = () => "/api/auth/sign-in-options";

const draft = defineDraftQuery("getSignInOptions", getGetSignInOptionsUrl, signInOptionsSchema);

export type getSignInOptionsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetSignInOptionsQueryResult = getSignInOptionsResponse;
export type GetSignInOptionsQueryError = Problem;

export const getSignInOptions = (options?: DraftRequest) => draft.fetcher([], options);

export const getGetSignInOptionsQueryKey = () => draft.queryKey();

export const getGetSignInOptionsQueryOptions = <TData = getSignInOptionsResponse, TError = Problem>(
  options?: DraftQueryOptions<getSignInOptionsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useGetSignInOptions = <TData = getSignInOptionsResponse, TError = Problem>(
  options?: DraftQueryOptions<getSignInOptionsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
