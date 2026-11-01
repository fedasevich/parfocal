import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";

export const nudgeSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  user_id: z.string(),
  sent_at: z.iso.datetime({ offset: true }),
});

export type Nudge = z.infer<typeof nudgeSchema>;

export type NudgeCreate = { user_id: string; message: string };

export type NudgeReviewerMutationVariables = { taskId: string; data: NudgeCreate };

export const getNudgeReviewerUrl = (taskId: string) => `/api/review-tasks/${taskId}/nudges`;

const nudgeDraft = defineDraftMutation(
  "nudgeReviewer",
  {
    method: "POST",
    url: ({ taskId }: NudgeReviewerMutationVariables) => getNudgeReviewerUrl(taskId),
    body: ({ data }) => data,
  },
  nudgeSchema,
);

export type nudgeReviewerResponse = Awaited<ReturnType<typeof nudgeDraft.fetcher>>;
export type NudgeReviewerMutationResult = nudgeReviewerResponse;
export type NudgeReviewerMutationError = Problem;

export const nudgeReviewer = (taskId: string, data: NudgeCreate, options?: DraftRequest) =>
  nudgeDraft.fetcher({ taskId, data }, options);

export const getNudgeReviewerMutationKey = () => nudgeDraft.mutationKey();

export const getNudgeReviewerMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    nudgeReviewerResponse,
    NudgeReviewerMutationVariables,
    TError,
    TContext
  >,
) => nudgeDraft.mutationOptions<TError, TContext>(options);

export const useNudgeReviewer = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    nudgeReviewerResponse,
    NudgeReviewerMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => nudgeDraft.useDraftMutation<TError, TContext>(options, queryClient);

export type CancelNudgeMutationVariables = { taskId: string; nudgeId: string };

export const getCancelNudgeUrl = (taskId: string, nudgeId: string) =>
  `/api/review-tasks/${taskId}/nudges/${nudgeId}`;

const cancelNudgeDraft = defineDraftMutation(
  "cancelNudge",
  {
    method: "DELETE",
    url: ({ taskId, nudgeId }: CancelNudgeMutationVariables) => getCancelNudgeUrl(taskId, nudgeId),
  },
  z.undefined(),
);

export type cancelNudgeResponse = Awaited<ReturnType<typeof cancelNudgeDraft.fetcher>>;
export type CancelNudgeMutationResult = cancelNudgeResponse;
export type CancelNudgeMutationError = Problem;

export const cancelNudge = (taskId: string, nudgeId: string, options?: DraftRequest) =>
  cancelNudgeDraft.fetcher({ taskId, nudgeId }, options);

export const getCancelNudgeMutationKey = () => cancelNudgeDraft.mutationKey();

export const getCancelNudgeMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    cancelNudgeResponse,
    CancelNudgeMutationVariables,
    TError,
    TContext
  >,
) => cancelNudgeDraft.mutationOptions<TError, TContext>(options);

export const useCancelNudge = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    cancelNudgeResponse,
    CancelNudgeMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => cancelNudgeDraft.useDraftMutation<TError, TContext>(options, queryClient);

export const ReassignWhat = { "not-started": "not-started", all: "all" } as const;

export const reassignmentSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  from_user_id: z.string(),
  to_user_id: z.string(),
  what: z.enum(ReassignWhat),
  slides_moved: z.number().int().nonnegative(),
});

export type Reassignment = z.infer<typeof reassignmentSchema>;

export type ReassignmentCreate = {
  from_user_id: string;
  to_user_id: string;
  what: keyof typeof ReassignWhat;
  note: string | null;
};

export type ReassignSlidesMutationVariables = { taskId: string; data: ReassignmentCreate };

export const getReassignSlidesUrl = (taskId: string) => `/api/review-tasks/${taskId}/reassignments`;

const reassignDraft = defineDraftMutation(
  "reassignSlides",
  {
    method: "POST",
    url: ({ taskId }: ReassignSlidesMutationVariables) => getReassignSlidesUrl(taskId),
    body: ({ data }) => data,
  },
  reassignmentSchema,
);

export type reassignSlidesResponse = Awaited<ReturnType<typeof reassignDraft.fetcher>>;
export type ReassignSlidesMutationResult = reassignSlidesResponse;
export type ReassignSlidesMutationError = Problem;

export const reassignSlides = (taskId: string, data: ReassignmentCreate, options?: DraftRequest) =>
  reassignDraft.fetcher({ taskId, data }, options);

export const getReassignSlidesMutationKey = () => reassignDraft.mutationKey();

export const getReassignSlidesMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    reassignSlidesResponse,
    ReassignSlidesMutationVariables,
    TError,
    TContext
  >,
) => reassignDraft.mutationOptions<TError, TContext>(options);

export const useReassignSlides = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    reassignSlidesResponse,
    ReassignSlidesMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => reassignDraft.useDraftMutation<TError, TContext>(options, queryClient);

export type UndoReassignmentMutationVariables = { taskId: string; reassignmentId: string };

export const getUndoReassignmentUrl = (taskId: string, reassignmentId: string) =>
  `/api/review-tasks/${taskId}/reassignments/${reassignmentId}`;

const undoReassignmentDraft = defineDraftMutation(
  "undoReassignment",
  {
    method: "DELETE",
    url: ({ taskId, reassignmentId }: UndoReassignmentMutationVariables) =>
      getUndoReassignmentUrl(taskId, reassignmentId),
  },
  z.undefined(),
);

export type undoReassignmentResponse = Awaited<ReturnType<typeof undoReassignmentDraft.fetcher>>;
export type UndoReassignmentMutationResult = undoReassignmentResponse;
export type UndoReassignmentMutationError = Problem;

export const undoReassignment = (taskId: string, reassignmentId: string, options?: DraftRequest) =>
  undoReassignmentDraft.fetcher({ taskId, reassignmentId }, options);

export const getUndoReassignmentMutationKey = () => undoReassignmentDraft.mutationKey();

export const getUndoReassignmentMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    undoReassignmentResponse,
    UndoReassignmentMutationVariables,
    TError,
    TContext
  >,
) => undoReassignmentDraft.mutationOptions<TError, TContext>(options);

export const useUndoReassignment = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    undoReassignmentResponse,
    UndoReassignmentMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => undoReassignmentDraft.useDraftMutation<TError, TContext>(options, queryClient);
