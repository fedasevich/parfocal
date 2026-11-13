import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";
import { signInSessionSchema } from "./sign-in-session.ts";

export const signInWithPasswordDraftSchema = z.object({
  email: z.string(),
  password: z.string(),
  keep_signed_in: z.boolean(),
  return_to: z.string().nullable(),
});

export type SignInWithPasswordDraft = z.infer<typeof signInWithPasswordDraftSchema>;

export type SignInWithPasswordMutationVariables = { data: SignInWithPasswordDraft };

export const getSignInWithPasswordUrl = () => "/api/auth/sign-in";

const draft = defineDraftMutation(
  "signInWithPassword",
  {
    method: "POST",
    url: () => getSignInWithPasswordUrl(),
    body: ({ data }: SignInWithPasswordMutationVariables) => data,
  },
  signInSessionSchema,
);

export type signInWithPasswordResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type SignInWithPasswordMutationResult = signInWithPasswordResponse;
export type SignInWithPasswordMutationError = Problem;

export const signInWithPassword = (data: SignInWithPasswordDraft, options?: DraftRequest) =>
  draft.fetcher({ data }, options);

export const getSignInWithPasswordMutationKey = () => draft.mutationKey();

export const getSignInWithPasswordMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    signInWithPasswordResponse,
    SignInWithPasswordMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useSignInWithPassword = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    signInWithPasswordResponse,
    SignInWithPasswordMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
