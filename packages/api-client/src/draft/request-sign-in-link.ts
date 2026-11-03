import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";
import { signInLinkSentSchema } from "./sign-in-session.ts";

export const requestSignInLinkDraftSchema = z.object({ email: z.string() });

export type RequestSignInLinkDraft = z.infer<typeof requestSignInLinkDraftSchema>;

export type RequestSignInLinkMutationVariables = { data: RequestSignInLinkDraft };

export const getRequestSignInLinkUrl = () => "/api/auth/sign-in-link";

const draft = defineDraftMutation(
  "requestSignInLink",
  {
    method: "POST",
    url: () => getRequestSignInLinkUrl(),
    body: ({ data }: RequestSignInLinkMutationVariables) => data,
  },
  signInLinkSentSchema,
);

export type requestSignInLinkResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type RequestSignInLinkMutationResult = requestSignInLinkResponse;
export type RequestSignInLinkMutationError = Problem;

export const requestSignInLink = (data: RequestSignInLinkDraft, options?: DraftRequest) =>
  draft.fetcher({ data }, options);

export const getRequestSignInLinkMutationKey = () => draft.mutationKey();

export const getRequestSignInLinkMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    requestSignInLinkResponse,
    RequestSignInLinkMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useRequestSignInLink = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    requestSignInLinkResponse,
    RequestSignInLinkMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
