import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { ModelRun, Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";

export const modelRunDefaultsSchema = z.object({
  slide_ids: z.array(z.string()),
  model_id: z.string(),
});

export type ModelRunDefaults = z.infer<typeof modelRunDefaultsSchema>;

export const getGetModelRunDefaultsUrl = (projectId: string) =>
  `/api/projects/${projectId}/model-runs/defaults`;

const defaultsDraft = defineDraftQuery(
  "getModelRunDefaults",
  getGetModelRunDefaultsUrl,
  modelRunDefaultsSchema,
);

export type getModelRunDefaultsResponse = Awaited<ReturnType<typeof defaultsDraft.fetcher>>;
export type GetModelRunDefaultsQueryResult = getModelRunDefaultsResponse;
export type GetModelRunDefaultsQueryError = Problem;

export const getModelRunDefaults = (projectId: string, options?: DraftRequest) =>
  defaultsDraft.fetcher([projectId], options);

export const getGetModelRunDefaultsQueryKey = (projectId: string) =>
  defaultsDraft.queryKey(projectId);

export const getGetModelRunDefaultsQueryOptions = <
  TData = getModelRunDefaultsResponse,
  TError = Problem,
>(
  projectId: string,
  options?: DraftQueryOptions<getModelRunDefaultsResponse, TData, TError>,
) => defaultsDraft.queryOptions<TData, TError>([projectId], options);

export const useGetModelRunDefaults = <TData = getModelRunDefaultsResponse, TError = Problem>(
  projectId: string,
  options?: DraftQueryOptions<getModelRunDefaultsResponse, TData, TError>,
  queryClient?: QueryClient,
) => defaultsDraft.useDraftQuery<TData, TError>([projectId], options, queryClient);

export type ModelRunMove = { server: string };

export type MoveModelRunMutationVariables = {
  projectId: string;
  runId: string;
  data: ModelRunMove;
};

export const getMoveModelRunUrl = (projectId: string, runId: string) =>
  `/api/projects/${projectId}/model-runs/${runId}/move`;

const moveDraft = defineDraftMutation(
  "moveModelRun",
  {
    method: "POST",
    url: ({ projectId, runId }: MoveModelRunMutationVariables) =>
      getMoveModelRunUrl(projectId, runId),
    body: ({ data }) => data,
  },
  z.custom<ModelRun>((value) => typeof value === "object" && value !== null && "id" in value),
);

export type moveModelRunResponse = Awaited<ReturnType<typeof moveDraft.fetcher>>;
export type MoveModelRunMutationResult = moveModelRunResponse;
export type MoveModelRunMutationError = Problem;

export const moveModelRun = (
  projectId: string,
  runId: string,
  data: ModelRunMove,
  options?: DraftRequest,
) => moveDraft.fetcher({ projectId, runId, data }, options);

export const getMoveModelRunMutationKey = () => moveDraft.mutationKey();

export const getMoveModelRunMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    moveModelRunResponse,
    MoveModelRunMutationVariables,
    TError,
    TContext
  >,
) => moveDraft.mutationOptions<TError, TContext>(options);

export const useMoveModelRun = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    moveModelRunResponse,
    MoveModelRunMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => moveDraft.useDraftMutation<TError, TContext>(options, queryClient);
