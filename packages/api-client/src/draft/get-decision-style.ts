import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const decisionStyleSchema = z.object({
  task_id: z.string(),
  kind: z.enum(["certainty", "agree", "yesno", "blind"]),
  question: z.string().nullable(),
  agree_from: z.number().int().min(2).max(5),
  disagree_to: z.number().int().min(1).max(4),
});

export type DecisionStyle = z.infer<typeof decisionStyleSchema>;

export const getGetDecisionStyleUrl = (taskId: string) =>
  `/api/review-tasks/${taskId}/decision-style`;

const draft = defineDraftQuery("getDecisionStyle", getGetDecisionStyleUrl, decisionStyleSchema);

export type getDecisionStyleResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetDecisionStyleQueryResult = getDecisionStyleResponse;
export type GetDecisionStyleQueryError = Problem;

export const getDecisionStyle = (taskId: string, options?: DraftRequest) =>
  draft.fetcher([taskId], options);

export const getGetDecisionStyleQueryKey = (taskId: string) => draft.queryKey(taskId);

export const getGetDecisionStyleQueryOptions = <TData = getDecisionStyleResponse, TError = Problem>(
  taskId: string,
  options?: DraftQueryOptions<getDecisionStyleResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([taskId], options);

export const useGetDecisionStyle = <TData = getDecisionStyleResponse, TError = Problem>(
  taskId: string,
  options?: DraftQueryOptions<getDecisionStyleResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([taskId], options, queryClient);
