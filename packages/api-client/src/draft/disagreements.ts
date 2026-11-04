import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";

export const QueueAnswer = { agree: "agree", disagree: "disagree", unsure: "unsure" } as const;
export const QueueTag = { differ: "differ", bothai: "bothai", second: "second" } as const;
export const QueueRowState = {
  open: "open",
  decided: "decided",
  leftOpen: "left-open",
  withAdjudicator: "with-adjudicator",
  declined: "declined",
  adjudicated: "adjudicated",
  lookAgain: "look-again",
} as const;
export const QueueAction = {
  decide: "decide",
  leaveOpen: "leave-open",
  lookAgain: "look-again",
  keepDecisions: "keep-decisions",
} as const;

const answer = z.enum(QueueAnswer);

const aiClaimSchema = z.object({ class_name: z.string(), score: z.number() });

export const queueAnswerSchema = z.object({
  user_id: z.string(),
  raw: answer,
  reason: z.string().nullable(),
  note: z.string().nullable(),
});

export type QueueAnswerRecord = z.infer<typeof queueAnswerSchema>;

export const queueRowSchema = z.object({
  key: z.string(),
  slide_id: z.string(),
  slide_label: z.string(),
  object: z.string(),
  kind: z.enum(["region", "cell"]),
  ai: aiClaimSchema,
  size_mm: z.number().nullable(),
  tag: z.enum(QueueTag),
  answers: z.array(queueAnswerSchema),
  state: z.enum(QueueRowState),
  decision: z
    .object({
      raw: answer,
      note: z.string().nullable(),
      by_user_id: z.string(),
      at: z.iso.datetime({ offset: true }),
    })
    .nullable(),
  adjudicator: z.object({ user_id: z.string(), note: z.string().nullable() }).nullable(),
  edited: z.object({ by_user_id: z.string(), on: z.iso.date() }).nullable(),
});

export type QueueRow = z.infer<typeof queueRowSchema>;

export const disagreementQueueSchema = z.object({
  task_id: z.string(),
  total_objects: z.number().int(),
  locked: z.object({ user_id: z.string(), slides_left: z.number().int() }).nullable(),
  rows: z.array(queueRowSchema),
});

export type DisagreementQueue = z.infer<typeof disagreementQueueSchema>;

export const getGetDisagreementQueueUrl = (taskId: string) =>
  `/api/review-tasks/${taskId}/disagreement-queue`;

const queueDraft = defineDraftQuery(
  "getDisagreementQueue",
  getGetDisagreementQueueUrl,
  disagreementQueueSchema,
);

export type getDisagreementQueueResponse = Awaited<ReturnType<typeof queueDraft.fetcher>>;
export type GetDisagreementQueueQueryResult = getDisagreementQueueResponse;
export type GetDisagreementQueueQueryError = Problem;

export const getDisagreementQueue = (taskId: string, options?: DraftRequest) =>
  queueDraft.fetcher([taskId], options);

export const getGetDisagreementQueueQueryKey = (taskId: string) => queueDraft.queryKey(taskId);

export const getGetDisagreementQueueQueryOptions = <
  TData = getDisagreementQueueResponse,
  TError = Problem,
>(
  taskId: string,
  options?: DraftQueryOptions<getDisagreementQueueResponse, TData, TError>,
) => queueDraft.queryOptions<TData, TError>([taskId], options);

export const useGetDisagreementQueue = <TData = getDisagreementQueueResponse, TError = Problem>(
  taskId: string,
  options?: DraftQueryOptions<getDisagreementQueueResponse, TData, TError>,
  queryClient?: QueryClient,
) => queueDraft.useDraftQuery<TData, TError>([taskId], options, queryClient);

export type QueuedObjectUpdate = {
  action: (typeof QueueAction)[keyof typeof QueueAction];
  raw?: (typeof QueueAnswer)[keyof typeof QueueAnswer];
  note?: string | null;
};

export type UpdateQueuedObjectMutationVariables = {
  taskId: string;
  slideId: string;
  object: string;
  data: QueuedObjectUpdate;
};

export const getUpdateQueuedObjectUrl = (taskId: string, slideId: string, object: string) =>
  `${getGetDisagreementQueueUrl(taskId)}/${slideId}/${encodeURIComponent(object)}`;

const updateDraft = defineDraftMutation(
  "updateQueuedObject",
  {
    method: "POST",
    url: ({ taskId, slideId, object }: UpdateQueuedObjectMutationVariables) =>
      getUpdateQueuedObjectUrl(taskId, slideId, object),
    body: ({ data }) => data,
  },
  queueRowSchema,
);

export type updateQueuedObjectResponse = Awaited<ReturnType<typeof updateDraft.fetcher>>;
export type UpdateQueuedObjectMutationResult = updateQueuedObjectResponse;
export type UpdateQueuedObjectMutationError = Problem;

export const updateQueuedObject = (
  variables: UpdateQueuedObjectMutationVariables,
  options?: DraftRequest,
) => updateDraft.fetcher(variables, options);

export const getUpdateQueuedObjectMutationKey = () => updateDraft.mutationKey();

export const getUpdateQueuedObjectMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    updateQueuedObjectResponse,
    UpdateQueuedObjectMutationVariables,
    TError,
    TContext
  >,
) => updateDraft.mutationOptions<TError, TContext>(options);

export const useUpdateQueuedObject = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    updateQueuedObjectResponse,
    UpdateQueuedObjectMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => updateDraft.useDraftMutation<TError, TContext>(options, queryClient);

const anonymousAnswerSchema = queueAnswerSchema.omit({ user_id: true });

export const adjudicationObjectSchema = z.object({
  key: z.string(),
  slide_id: z.string(),
  slide_label: z.string(),
  object: z.string(),
  kind: z.enum(["region", "cell"]),
  ai: aiClaimSchema,
  size_mm: z.number().nullable(),
  reviewer_a: anonymousAnswerSchema,
  reviewer_b: anonymousAnswerSchema,
  decision: answer.nullable(),
});

export type AdjudicationObject = z.infer<typeof adjudicationObjectSchema>;

export const myAdjudicationTaskSchema = z.object({
  task_id: z.string(),
  asked_by_user_id: z.string(),
  objects: z.array(adjudicationObjectSchema),
});

export type MyAdjudicationTask = z.infer<typeof myAdjudicationTaskSchema>;

export const getGetMyAdjudicationUrl = (taskId: string) =>
  `/api/review-tasks/${taskId}/adjudication`;

const adjudicationDraft = defineDraftQuery(
  "getMyAdjudication",
  getGetMyAdjudicationUrl,
  myAdjudicationTaskSchema,
);

export type getMyAdjudicationResponse = Awaited<ReturnType<typeof adjudicationDraft.fetcher>>;
export type GetMyAdjudicationQueryResult = getMyAdjudicationResponse;
export type GetMyAdjudicationQueryError = Problem;

export const getMyAdjudication = (taskId: string, options?: DraftRequest) =>
  adjudicationDraft.fetcher([taskId], options);

export const getGetMyAdjudicationQueryKey = (taskId: string) => adjudicationDraft.queryKey(taskId);

export const getGetMyAdjudicationQueryOptions = <
  TData = getMyAdjudicationResponse,
  TError = Problem,
>(
  taskId: string,
  options?: DraftQueryOptions<getMyAdjudicationResponse, TData, TError>,
) => adjudicationDraft.queryOptions<TData, TError>([taskId], options);

export const useGetMyAdjudication = <TData = getMyAdjudicationResponse, TError = Problem>(
  taskId: string,
  options?: DraftQueryOptions<getMyAdjudicationResponse, TData, TError>,
  queryClient?: QueryClient,
) => adjudicationDraft.useDraftQuery<TData, TError>([taskId], options, queryClient);

export type DecideAdjudicationMutationVariables = {
  taskId: string;
  slideId: string;
  object: string;
  data: { raw: (typeof QueueAnswer)[keyof typeof QueueAnswer] };
};

export const getDecideAdjudicationUrl = (taskId: string, slideId: string, object: string) =>
  `${getGetMyAdjudicationUrl(taskId)}/${slideId}/${encodeURIComponent(object)}`;

const decideDraft = defineDraftMutation(
  "decideAdjudication",
  {
    method: "POST",
    url: ({ taskId, slideId, object }: DecideAdjudicationMutationVariables) =>
      getDecideAdjudicationUrl(taskId, slideId, object),
    body: ({ data }) => data,
  },
  adjudicationObjectSchema,
);

export type decideAdjudicationResponse = Awaited<ReturnType<typeof decideDraft.fetcher>>;
export type DecideAdjudicationMutationResult = decideAdjudicationResponse;
export type DecideAdjudicationMutationError = Problem;

export const decideAdjudication = (
  variables: DecideAdjudicationMutationVariables,
  options?: DraftRequest,
) => decideDraft.fetcher(variables, options);

export const getDecideAdjudicationMutationKey = () => decideDraft.mutationKey();

export const getDecideAdjudicationMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    decideAdjudicationResponse,
    DecideAdjudicationMutationVariables,
    TError,
    TContext
  >,
) => decideDraft.mutationOptions<TError, TContext>(options);

export const useDecideAdjudication = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    decideAdjudicationResponse,
    DecideAdjudicationMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => decideDraft.useDraftMutation<TError, TContext>(options, queryClient);
