import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";
import { signInSessionSchema } from "./sign-in-session.ts";

export const confirmEmailDraftSchema = z.object({
  email: z.string(),
  code: z.string(),
});

export type ConfirmEmailDraft = z.infer<typeof confirmEmailDraftSchema>;

export type ConfirmEmailMutationVariables = { data: ConfirmEmailDraft };

export const getConfirmEmailUrl = () => "/api/auth/sign-up/confirm";

const draft = defineDraftMutation(
  "confirmEmail",
  {
    method: "POST",
    url: () => getConfirmEmailUrl(),
    body: ({ data }: ConfirmEmailMutationVariables) => data,
  },
  signInSessionSchema,
);

export type confirmEmailResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ConfirmEmailMutationResult = confirmEmailResponse;
export type ConfirmEmailMutationError = Problem;

export const confirmEmail = (data: ConfirmEmailDraft, options?: DraftRequest) =>
  draft.fetcher({ data }, options);

export const getConfirmEmailMutationKey = () => draft.mutationKey();

export const getConfirmEmailMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    confirmEmailResponse,
    ConfirmEmailMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useConfirmEmail = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    confirmEmailResponse,
    ConfirmEmailMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
