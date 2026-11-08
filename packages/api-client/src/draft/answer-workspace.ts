import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";

export const workspaceAnswerSchema = z.object({
  workspace_id: z.string(),
  how: z.enum(["join", "ask"]),
});

export type WorkspaceAnswer = z.infer<typeof workspaceAnswerSchema>;

export const workspaceAnsweredSchema = z.object({
  workspace_id: z.string(),
  state: z.enum(["joined", "requested"]),
});

export type WorkspaceAnswered = z.infer<typeof workspaceAnsweredSchema>;

export type AnswerWorkspaceMutationVariables = { data: WorkspaceAnswer };

export const getAnswerWorkspaceUrl = () => "/api/me/workspace-answers";

const draft = defineDraftMutation(
  "answerWorkspace",
  {
    method: "POST",
    url: () => getAnswerWorkspaceUrl(),
    body: ({ data }: AnswerWorkspaceMutationVariables) => data,
  },
  workspaceAnsweredSchema,
);

export type answerWorkspaceResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type AnswerWorkspaceMutationResult = answerWorkspaceResponse;
export type AnswerWorkspaceMutationError = Problem;

export const answerWorkspace = (data: WorkspaceAnswer, options?: DraftRequest) =>
  draft.fetcher({ data }, options);

export const getAnswerWorkspaceMutationKey = () => draft.mutationKey();

export const getAnswerWorkspaceMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    answerWorkspaceResponse,
    AnswerWorkspaceMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useAnswerWorkspace = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    answerWorkspaceResponse,
    AnswerWorkspaceMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
