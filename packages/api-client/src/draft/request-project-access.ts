import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";

export const accessRequestSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  user_id: z.string(),
  owner_id: z.string(),
  asked_at: z.iso.datetime({ offset: true }),
});

export type AccessRequest = z.infer<typeof accessRequestSchema>;

export type RequestProjectAccessMutationVariables = { projectId: string };

export const getRequestProjectAccessUrl = (projectId: string) =>
  `/api/projects/${projectId}/access-requests`;

const draft = defineDraftMutation(
  "requestProjectAccess",
  {
    method: "POST",
    url: ({ projectId }: RequestProjectAccessMutationVariables) =>
      getRequestProjectAccessUrl(projectId),
  },
  accessRequestSchema,
);

export type requestProjectAccessResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type RequestProjectAccessMutationResult = requestProjectAccessResponse;
export type RequestProjectAccessMutationError = Problem;

export const requestProjectAccess = (projectId: string, options?: DraftRequest) =>
  draft.fetcher({ projectId }, options);

export const getRequestProjectAccessMutationKey = () => draft.mutationKey();

export const getRequestProjectAccessMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    requestProjectAccessResponse,
    RequestProjectAccessMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useRequestProjectAccess = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    requestProjectAccessResponse,
    RequestProjectAccessMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
