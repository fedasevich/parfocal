import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

const settingValue = z.union([z.string(), z.number(), z.boolean()]);

export const taskDisplaySchema = z.object({
  task_id: z.string(),
  task_code: z.string(),
  locks: z.array(z.object({ setting: z.string(), value: settingValue, reason: z.string() })),
  presets: z.array(
    z.object({ name: z.string(), key: z.string(), settings: z.record(z.string(), settingValue) }),
  ),
});

export type TaskDisplay = z.infer<typeof taskDisplaySchema>;

export const getGetTaskDisplayUrl = (taskId: string) => `/api/review-tasks/${taskId}/display`;

const draft = defineDraftQuery("getTaskDisplay", getGetTaskDisplayUrl, taskDisplaySchema);

export type getTaskDisplayResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetTaskDisplayQueryResult = getTaskDisplayResponse;
export type GetTaskDisplayQueryError = Problem;

export const getTaskDisplay = (taskId: string, options?: DraftRequest) =>
  draft.fetcher([taskId], options);

export const getGetTaskDisplayQueryKey = (taskId: string) => draft.queryKey(taskId);

export const getGetTaskDisplayQueryOptions = <TData = getTaskDisplayResponse, TError = Problem>(
  taskId: string,
  options?: DraftQueryOptions<getTaskDisplayResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([taskId], options);

export const useGetTaskDisplay = <TData = getTaskDisplayResponse, TError = Problem>(
  taskId: string,
  options?: DraftQueryOptions<getTaskDisplayResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([taskId], options, queryClient);
