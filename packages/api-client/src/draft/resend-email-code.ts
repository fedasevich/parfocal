import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";
import { accountCodeSentSchema } from "./sign-up-session.ts";

export const resendEmailCodeDraftSchema = z.object({ email: z.string() });

export type ResendEmailCodeDraft = z.infer<typeof resendEmailCodeDraftSchema>;

export type ResendEmailCodeMutationVariables = { data: ResendEmailCodeDraft };

export const getResendEmailCodeUrl = () => "/api/auth/sign-up/resend";

const draft = defineDraftMutation(
  "resendEmailCode",
  {
    method: "POST",
    url: () => getResendEmailCodeUrl(),
    body: ({ data }: ResendEmailCodeMutationVariables) => data,
  },
  accountCodeSentSchema,
);

export type resendEmailCodeResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ResendEmailCodeMutationResult = resendEmailCodeResponse;
export type ResendEmailCodeMutationError = Problem;

export const resendEmailCode = (data: ResendEmailCodeDraft, options?: DraftRequest) =>
  draft.fetcher({ data }, options);

export const getResendEmailCodeMutationKey = () => draft.mutationKey();

export const getResendEmailCodeMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    resendEmailCodeResponse,
    ResendEmailCodeMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useResendEmailCode = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    resendEmailCodeResponse,
    ResendEmailCodeMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
