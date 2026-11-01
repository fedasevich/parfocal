import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const ChecklistStepKey = {
  "confirm-email": "confirm-email",
  "join-workspace": "join-workspace",
  "open-sample": "open-sample",
  "guided-review": "guided-review",
  comment: "comment",
  opinion: "opinion",
} as const;

export const checklistSchema = z.object({
  hidden: z.boolean(),
  steps: z.array(z.object({ key: z.enum(ChecklistStepKey), label: z.string(), done: z.boolean() })),
  sample_project: z
    .object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
      slides: z.number().int().nonnegative(),
    })
    .nullable(),
});

export type Checklist = z.infer<typeof checklistSchema>;

export const getGetMyChecklistUrl = () => "/api/me/checklist";

const draft = defineDraftQuery("getMyChecklist", getGetMyChecklistUrl, checklistSchema);

export type getMyChecklistResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetMyChecklistQueryResult = getMyChecklistResponse;
export type GetMyChecklistQueryError = Problem;

export const getMyChecklist = (options?: DraftRequest) => draft.fetcher([], options);

export const getGetMyChecklistQueryKey = () => draft.queryKey();

export const getGetMyChecklistQueryOptions = <TData = getMyChecklistResponse, TError = Problem>(
  options?: DraftQueryOptions<getMyChecklistResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useGetMyChecklist = <TData = getMyChecklistResponse, TError = Problem>(
  options?: DraftQueryOptions<getMyChecklistResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
