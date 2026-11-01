import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const threadCommentSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  author_id: z.string(),
  author_is_researcher: z.boolean(),
  text: z.string(),
  reply_to: z.string().nullable(),
  created_at: z.string(),
});

export type ThreadComment = z.infer<typeof threadCommentSchema>;

export const getListThreadCommentsUrl = (threadId: string) => `/api/threads/${threadId}/comments`;

const draft = defineDraftQuery(
  "listThreadComments",
  getListThreadCommentsUrl,
  z.array(threadCommentSchema),
);

export type listThreadCommentsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListThreadCommentsQueryResult = listThreadCommentsResponse;
export type ListThreadCommentsQueryError = Problem;

export const listThreadComments = (threadId: string, options?: DraftRequest) =>
  draft.fetcher([threadId], options);

export const getListThreadCommentsQueryKey = (threadId: string) => draft.queryKey(threadId);

export const getListThreadCommentsQueryOptions = <
  TData = listThreadCommentsResponse,
  TError = Problem,
>(
  threadId: string,
  options?: DraftQueryOptions<listThreadCommentsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([threadId], options);

export const useListThreadComments = <TData = listThreadCommentsResponse, TError = Problem>(
  threadId: string,
  options?: DraftQueryOptions<listThreadCommentsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([threadId], options, queryClient);
