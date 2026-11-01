import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";
import { aiModelSchema } from "./list-ai-models.ts";

export const labModelDraftSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  address: z.url(),
  sign_in: z.enum(["none", "token", "header"]),
  tile_size: z.number().int().positive(),
  magnification: z.number().int().positive(),
  taxonomy: z.string(),
  class_map: z.array(z.object({ sent: z.string(), becomes: z.string().nullable() })),
  who_can_run: z.enum(["admins", "researchers"]),
  project_ids: z.array(z.string()),
});

export type LabModelDraft = z.infer<typeof labModelDraftSchema>;

export type ConnectLabModelMutationVariables = { data: LabModelDraft };

export const getConnectLabModelUrl = () => "/api/tenant/models";

const draft = defineDraftMutation(
  "connectLabModel",
  {
    method: "POST",
    url: () => getConnectLabModelUrl(),
    body: ({ data }: ConnectLabModelMutationVariables) => data,
  },
  aiModelSchema,
);

export type connectLabModelResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ConnectLabModelMutationResult = connectLabModelResponse;
export type ConnectLabModelMutationError = Problem;

export const connectLabModel = (data: LabModelDraft, options?: DraftRequest) =>
  draft.fetcher({ data }, options);

export const getConnectLabModelMutationKey = () => draft.mutationKey();

export const getConnectLabModelMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    connectLabModelResponse,
    ConnectLabModelMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useConnectLabModel = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    connectLabModelResponse,
    ConnectLabModelMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
