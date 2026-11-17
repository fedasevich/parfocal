import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { ModelRun, Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";

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
