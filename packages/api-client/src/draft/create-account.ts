import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";
import { accountCodeSentSchema } from "./sign-up-session.ts";

export const createAccountDraftSchema = z.object({
  name: z.string(),
  email: z.string(),
  password: z.string(),
  role: z.enum(["run", "review"]),
  accepted_terms: z.boolean(),
});

export type CreateAccountDraft = z.infer<typeof createAccountDraftSchema>;

export type CreateAccountMutationVariables = { data: CreateAccountDraft };

export const getCreateAccountUrl = () => "/api/auth/sign-up";

const draft = defineDraftMutation(
  "createAccount",
  {
    method: "POST",
    url: () => getCreateAccountUrl(),
    body: ({ data }: CreateAccountMutationVariables) => data,
  },
  accountCodeSentSchema,
);

export type createAccountResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type CreateAccountMutationResult = createAccountResponse;
export type CreateAccountMutationError = Problem;

export const createAccount = (data: CreateAccountDraft, options?: DraftRequest) =>
  draft.fetcher({ data }, options);

export const getCreateAccountMutationKey = () => draft.mutationKey();

export const getCreateAccountMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    createAccountResponse,
    CreateAccountMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useCreateAccount = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    createAccountResponse,
    CreateAccountMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
