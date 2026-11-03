import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";
import { signInSessionSchema } from "./sign-in-session.ts";

export const startSsoDraftSchema = z.object({
  workspace_id: z.string(),
  return_to: z.string().nullable(),
});

export type StartSsoDraft = z.infer<typeof startSsoDraftSchema>;

export type StartSsoMutationVariables = { data: StartSsoDraft };

export const getStartSsoUrl = () => "/api/auth/sso";

const draft = defineDraftMutation(
  "startSso",
  {
    method: "POST",
    url: () => getStartSsoUrl(),
    body: ({ data }: StartSsoMutationVariables) => data,
  },
  signInSessionSchema,
);

export type startSsoResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type StartSsoMutationResult = startSsoResponse;
export type StartSsoMutationError = Problem;

export const startSso = (data: StartSsoDraft, options?: DraftRequest) =>
  draft.fetcher({ data }, options);

export const getStartSsoMutationKey = () => draft.mutationKey();

export const getStartSsoMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<startSsoResponse, StartSsoMutationVariables, TError, TContext>,
) => draft.mutationOptions<TError, TContext>(options);

export const useStartSso = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<startSsoResponse, StartSsoMutationVariables, TError, TContext>,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
