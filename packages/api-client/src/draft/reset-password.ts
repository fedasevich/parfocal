import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";
import { signInSessionSchema } from "./sign-in-session.ts";

export const resetPasswordDraftSchema = z.object({
  email: z.string(),
  password: z.string(),
  return_to: z.string().nullable(),
});

export type ResetPasswordDraft = z.infer<typeof resetPasswordDraftSchema>;

export type ResetPasswordMutationVariables = { data: ResetPasswordDraft };

export const getResetPasswordUrl = () => "/api/auth/password-reset/confirm";

const draft = defineDraftMutation(
  "resetPassword",
  {
    method: "POST",
    url: () => getResetPasswordUrl(),
    body: ({ data }: ResetPasswordMutationVariables) => data,
  },
  signInSessionSchema,
);

export type resetPasswordResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ResetPasswordMutationResult = resetPasswordResponse;
export type ResetPasswordMutationError = Problem;

export const resetPassword = (data: ResetPasswordDraft, options?: DraftRequest) =>
  draft.fetcher({ data }, options);

export const getResetPasswordMutationKey = () => draft.mutationKey();

export const getResetPasswordMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    resetPasswordResponse,
    ResetPasswordMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useResetPassword = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    resetPasswordResponse,
    ResetPasswordMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
