import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";

const changeSchema = z.object({
  by_user_id: z.string(),
  at: z.iso.datetime({ offset: true }),
  object: z.string(),
  slide_label: z.string(),
  text: z.string(),
  reason: z.string(),
});

export type EvaluationChange = z.infer<typeof changeSchema>;

const nextVersionSchema = z.object({
  version: z.number().int(),
  reason: z.string(),
  by_user_id: z.string(),
  started_at: z.iso.datetime({ offset: true }),
});

export type EvaluationVersionStarted = z.infer<typeof nextVersionSchema>;

const countByPerson = z.object({ user_id: z.string(), count: z.number().int() });

export const signOffSummarySchema = z.object({
  task_id: z.string(),
  version: z.number().int(),
  reviewer_ids: z.array(z.string()),
  reviews: z.object({
    slides: z.number().int(),
    submitted: z.number().int(),
    total: z.number().int(),
    opinion_forms: z.number().int(),
    behind: z.array(z.object({ user_id: z.string(), slides_left: z.number().int() })),
  }),
  queue: z.object({
    total: z.number().int(),
    resolved: z.number().int(),
    by_researcher: z.number().int(),
    by_adjudicator: z.array(countByPerson),
    with_adjudicator: z.array(countByPerson),
    left_open: z.array(z.object({ object: z.string(), slide_label: z.string() })),
  }),
  open_threads: z.object({
    total: z.number().int(),
    slides: z.array(z.object({ slide_label: z.string(), count: z.number().int() })),
  }),
  result_set: z.object({
    name: z.string(),
    objects: z.number().int(),
    added: z.number().int(),
  }),
  signature: z
    .object({
      by_user_id: z.string(),
      at: z.iso.datetime({ offset: true }),
      checksum: z.string(),
    })
    .nullable(),
  changes: z.array(changeSchema),
  next_version: nextVersionSchema.nullable(),
});

export type SignOffSummary = z.infer<typeof signOffSummarySchema>;

export const getGetSignOffSummaryUrl = (taskId: string) =>
  `/api/review-tasks/${taskId}/sign-off-summary`;

const summaryDraft = defineDraftQuery(
  "getSignOffSummary",
  getGetSignOffSummaryUrl,
  signOffSummarySchema,
);

export type getSignOffSummaryResponse = Awaited<ReturnType<typeof summaryDraft.fetcher>>;
export type GetSignOffSummaryQueryResult = getSignOffSummaryResponse;
export type GetSignOffSummaryQueryError = Problem;

export const getSignOffSummary = (taskId: string, options?: DraftRequest) =>
  summaryDraft.fetcher([taskId], options);

export const getGetSignOffSummaryQueryKey = (taskId: string) => summaryDraft.queryKey(taskId);

export const getGetSignOffSummaryQueryOptions = <
  TData = getSignOffSummaryResponse,
  TError = Problem,
>(
  taskId: string,
  options?: DraftQueryOptions<getSignOffSummaryResponse, TData, TError>,
) => summaryDraft.queryOptions<TData, TError>([taskId], options);

export const useGetSignOffSummary = <TData = getSignOffSummaryResponse, TError = Problem>(
  taskId: string,
  options?: DraftQueryOptions<getSignOffSummaryResponse, TData, TError>,
  queryClient?: QueryClient,
) => summaryDraft.useDraftQuery<TData, TError>([taskId], options, queryClient);

export type StartEvaluationVersionMutationVariables = {
  taskId: string;
  data: { reason: string };
};

export const getStartEvaluationVersionUrl = (taskId: string) =>
  `/api/review-tasks/${taskId}/evaluation-versions`;

const startDraft = defineDraftMutation(
  "startEvaluationVersion",
  {
    method: "POST",
    url: ({ taskId }: StartEvaluationVersionMutationVariables) =>
      getStartEvaluationVersionUrl(taskId),
    body: ({ data }) => data,
  },
  nextVersionSchema,
);

export type startEvaluationVersionResponse = Awaited<ReturnType<typeof startDraft.fetcher>>;
export type StartEvaluationVersionMutationResult = startEvaluationVersionResponse;
export type StartEvaluationVersionMutationError = Problem;

export const startEvaluationVersion = (
  variables: StartEvaluationVersionMutationVariables,
  options?: DraftRequest,
) => startDraft.fetcher(variables, options);

export const getStartEvaluationVersionMutationKey = () => startDraft.mutationKey();

export const getStartEvaluationVersionMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    startEvaluationVersionResponse,
    StartEvaluationVersionMutationVariables,
    TError,
    TContext
  >,
) => startDraft.mutationOptions<TError, TContext>(options);

export const useStartEvaluationVersion = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    startEvaluationVersionResponse,
    StartEvaluationVersionMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => startDraft.useDraftMutation<TError, TContext>(options, queryClient);

export const ReportBlockKind = {
  headline: "headline-numbers",
  regions: "region-metrics",
  confusion: "confusion-matrix",
  agreement: "reviewer-agreement",
  reasons: "disagreement-reasons",
  opinions: "opinion-answers",
  worst: "worst-objects",
  slides: "slide-table",
  figure: "slide-figure",
  text: "text",
  comparison: "comparison",
} as const;

export const reportBlockSchema = z.object({
  kind: z.enum(ReportBlockKind),
  title: z.string(),
  width: z.enum(["full", "half"]),
  show_title: z.boolean().default(true),
  page_break: z.boolean().default(false),
  metrics: z.array(z.string()).optional(),
  columns: z.array(z.string()).optional(),
  rows: z.number().int().nullable().optional(),
  top: z.number().int().nullable().optional(),
  body: z.string().optional(),
  caption: z.string().optional(),
  slide_id: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  task_id: z.string().nullable().optional(),
});

export type EvaluationReportBlock = z.infer<typeof reportBlockSchema>;

export const reportFormatSchema = z.object({
  paper: z.enum(["a4", "letter"]).default("a4"),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  text_size: z.enum(["small", "normal", "large"]).default("normal"),
  running_header: z.boolean().default(true),
  page_numbers: z.enum(["none", "page", "page-of"]).default("page-of"),
  draft_watermark: z.boolean().default(true),
  signature: z.boolean().default(true),
  label_language: z.enum(["en", "cs", "de"]).default("en"),
  decimals: z.number().int().min(0).max(4).default(2),
  appendices: z.array(z.enum(["objects", "decisions", "methods"])).default(["objects"]),
});

export type EvaluationReportFormat = z.infer<typeof reportFormatSchema>;

export const evaluationReportSchema = z.object({
  task_id: z.string(),
  task_code: z.string(),
  round_name: z.string(),
  model: z.string(),
  project: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  lab: z.object({ name: z.string(), short: z.string() }),
  slides: z.number().int(),
  objects: z.number().int(),
  reviewer_ids: z.array(z.string()),
  adjudicators: z.number().int(),
  version: z.number().int(),
  signed_at: z.iso.datetime({ offset: true }).nullable(),
  signed_by_user_id: z.string().nullable(),
  template: z.object({
    id: z.string(),
    name: z.string(),
    version: z.number().int(),
    latest_version: z.number().int(),
    retired_on: z.iso.date().nullable(),
    blocks: z.array(reportBlockSchema),
    format: reportFormatSchema.default(reportFormatSchema.parse({})),
  }),
  formats: z.array(z.object({ key: z.string(), label: z.string() })),
  confusion: z.object({
    classes: z.array(z.string()),
    counts: z.array(z.array(z.number().int())),
  }),
  worst: z.array(
    z.object({
      object: z.string(),
      what: z.string(),
      answers: z.array(
        z.object({ user_id: z.string(), raw: z.enum(["agree", "disagree", "unsure"]) }),
      ),
    }),
  ),
  opinion_question: z.string(),
  changes: z.array(changeSchema),
});

export type EvaluationReport = z.infer<typeof evaluationReportSchema>;

export const getGetEvaluationReportUrl = (taskId: string) =>
  `/api/review-tasks/${taskId}/evaluation-report`;

const reportDraft = defineDraftQuery(
  "getEvaluationReport",
  getGetEvaluationReportUrl,
  evaluationReportSchema,
);

export type getEvaluationReportResponse = Awaited<ReturnType<typeof reportDraft.fetcher>>;
export type GetEvaluationReportQueryResult = getEvaluationReportResponse;
export type GetEvaluationReportQueryError = Problem;

export const getEvaluationReport = (taskId: string, options?: DraftRequest) =>
  reportDraft.fetcher([taskId], options);

export const getGetEvaluationReportQueryKey = (taskId: string) => reportDraft.queryKey(taskId);

export const getGetEvaluationReportQueryOptions = <
  TData = getEvaluationReportResponse,
  TError = Problem,
>(
  taskId: string,
  options?: DraftQueryOptions<getEvaluationReportResponse, TData, TError>,
) => reportDraft.queryOptions<TData, TError>([taskId], options);

export const useGetEvaluationReport = <TData = getEvaluationReportResponse, TError = Problem>(
  taskId: string,
  options?: DraftQueryOptions<getEvaluationReportResponse, TData, TError>,
  queryClient?: QueryClient,
) => reportDraft.useDraftQuery<TData, TError>([taskId], options, queryClient);
