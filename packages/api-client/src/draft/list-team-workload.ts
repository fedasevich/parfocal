import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const TeamReviewerStatus = {
  "on-track": "on-track",
  behind: "behind",
  "not-started": "not-started",
  away: "away",
  done: "done",
} as const;

export const teamReviewerSchema = z.object({
  user_id: z.string(),
  slides_done: z.number().int().nonnegative(),
  slides_assigned: z.number().int().nonnegative(),
  status: z.enum(TeamReviewerStatus),
  minutes_left: z.number().int().nonnegative(),
  away_until: z.iso.date().nullable(),
  assigned_at: z.iso.datetime({ offset: true }),
  last_decision_at: z.iso.datetime({ offset: true }).nullable(),
  nudged_at: z.iso.datetime({ offset: true }).nullable(),
});

export type TeamReviewer = z.infer<typeof teamReviewerSchema>;

export const teamTaskSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  project: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  slides: z.number().int().nonnegative(),
  split: z.enum(["all", "even"]),
  sent_on: z.iso.date(),
  due_on: z.iso.date(),
  signed_on: z.iso.date().nullable(),
  reviewers: z.array(teamReviewerSchema),
});

export type TeamTask = z.infer<typeof teamTaskSchema>;

export const teamWorkloadSchema = z.object({
  as_of: z.iso.datetime({ offset: true }),
  open: z.array(teamTaskSchema),
  done: z.array(teamTaskSchema),
});

export type TeamWorkload = z.infer<typeof teamWorkloadSchema>;

export const getListTeamWorkloadUrl = () => "/api/me/team";

const draft = defineDraftQuery("listTeamWorkload", getListTeamWorkloadUrl, teamWorkloadSchema);

export type listTeamWorkloadResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListTeamWorkloadQueryResult = listTeamWorkloadResponse;
export type ListTeamWorkloadQueryError = Problem;

export const listTeamWorkload = (options?: DraftRequest) => draft.fetcher([], options);

export const getListTeamWorkloadQueryKey = () => draft.queryKey();

export const getListTeamWorkloadQueryOptions = <TData = listTeamWorkloadResponse, TError = Problem>(
  options?: DraftQueryOptions<listTeamWorkloadResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useListTeamWorkload = <TData = listTeamWorkloadResponse, TError = Problem>(
  options?: DraftQueryOptions<listTeamWorkloadResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
