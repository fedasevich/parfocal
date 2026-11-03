import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";
import { signInSessionSchema } from "./sign-in-session.ts";

export const signInWithCodeDraftSchema = z.object({
  email: z.string(),
  code: z.string(),
  return_to: z.string().nullable(),
});

export type SignInWithCodeDraft = z.infer<typeof signInWithCodeDraftSchema>;

export type SignInWithCodeMutationVariables = { data: SignInWithCodeDraft };

export const getSignInWithCodeUrl = () => "/api/auth/sign-in-code";

const draft = defineDraftMutation(
  "signInWithCode",
  {
    method: "POST",
    url: () => getSignInWithCodeUrl(),
    body: ({ data }: SignInWithCodeMutationVariables) => data,
  },
  signInSessionSchema,
);

export type signInWithCodeResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type SignInWithCodeMutationResult = signInWithCodeResponse;
export type SignInWithCodeMutationError = Problem;

export const signInWithCode = (data: SignInWithCodeDraft, options?: DraftRequest) =>
  draft.fetcher({ data }, options);

export const getSignInWithCodeMutationKey = () => draft.mutationKey();

export const getSignInWithCodeMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    signInWithCodeResponse,
    SignInWithCodeMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useSignInWithCode = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    signInWithCodeResponse,
    SignInWithCodeMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
