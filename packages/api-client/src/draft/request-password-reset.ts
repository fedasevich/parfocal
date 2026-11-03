import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";
import { passwordResetSentSchema } from "./sign-in-session.ts";

export const requestPasswordResetDraftSchema = z.object({ email: z.string() });

export type RequestPasswordResetDraft = z.infer<typeof requestPasswordResetDraftSchema>;

export type RequestPasswordResetMutationVariables = { data: RequestPasswordResetDraft };

export const getRequestPasswordResetUrl = () => "/api/auth/password-reset";

const draft = defineDraftMutation(
  "requestPasswordReset",
  {
    method: "POST",
    url: () => getRequestPasswordResetUrl(),
    body: ({ data }: RequestPasswordResetMutationVariables) => data,
  },
  passwordResetSentSchema,
);

export type requestPasswordResetResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type RequestPasswordResetMutationResult = requestPasswordResetResponse;
export type RequestPasswordResetMutationError = Problem;

export const requestPasswordReset = (data: RequestPasswordResetDraft, options?: DraftRequest) =>
  draft.fetcher({ data }, options);

export const getRequestPasswordResetMutationKey = () => draft.mutationKey();

export const getRequestPasswordResetMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    requestPasswordResetResponse,
    RequestPasswordResetMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useRequestPasswordReset = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    requestPasswordResetResponse,
    RequestPasswordResetMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
