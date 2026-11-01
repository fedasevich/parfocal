import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

const pairingSchema = z.object({
  slide: z.number().int().nonnegative().nullable(),
  how: z.string(),
  warn: z.string().nullable(),
});

const stepSchema = z.object({ label: z.string(), detail: z.string() });

export const uploadBatchSlideSchema = z.object({
  name: z.string(),
  format: z.string(),
  size_gb: z.number().positive(),
  case_label: z.string().nullable(),
  steps: z.array(stepSchema),
  steps_done: z.number().int().nonnegative(),
  running: z.object({ percent: z.number(), text: z.string() }).nullable(),
  progress: z.object({
    percent: z.number().min(0).max(100),
    tone: z.enum(["ok", "tiles", "accent"]),
    text: z.string(),
  }),
  extra_result: z.object({ name: z.string(), detail: z.string() }),
});

export const uploadBatchResultSchema = z.object({
  name: z.string(),
  detail: z.string(),
  pairings: z.object({ auto: pairingSchema, name: pairingSchema, id: pairingSchema }),
});

export const uploadProblemSchema = z.object({
  kind: z.enum(["read-error", "scale", "new-classes"]),
  result: z.number().int().nonnegative(),
  title: z.string(),
  text: z.string(),
  lines: z.array(z.object({ line: z.string(), object: z.string(), error: z.string() })),
  fix: z.string(),
  fixed: z.string(),
});

export const uploadBatchSchema = z.object({
  project_id: z.string(),
  slides: z.array(uploadBatchSlideSchema),
  results: z.array(uploadBatchResultSchema),
  folder_tree: z.array(z.object({ name: z.string(), note: z.string(), depth: z.number() })),
  problems: z.array(uploadProblemSchema),
  new_classes: z.array(
    z.object({ name: z.string(), cells: z.number(), to: z.string().nullable() }),
  ),
  unscored_rows: z.number().int().nonnegative(),
  duplicate: z.object({ slide: z.number().int().nonnegative(), uploaded_on: z.string() }),
  storage: z.object({
    needed_gb: z.number(),
    left_gb: z.number(),
    allowance_gb: z.number(),
    trimmed_gb: z.number(),
    trimmed_slides: z.number().int(),
  }),
  source_outage: z.object({ source: z.string(), at: z.string(), waiting: z.number().int() }),
  done: z.object({ minutes: z.number().int(), first_ids: z.string() }),
  result_preview: z.object({
    slide_label: z.string(),
    case_label: z.string(),
    beside: z.string(),
    file: z.string(),
    detail: z.string(),
    model: z.string(),
    version: z.string(),
    checks: z.array(z.string()),
    level: z.number().int(),
    scale: z.number(),
    shift: z.tuple([z.number(), z.number()]),
  }),
  format_check: z.object({
    file: z.string(),
    detail: z.string(),
    findings: z.array(z.object({ tone: z.enum(["ok", "warn"]), text: z.string() })),
  }),
});

export type UploadBatch = z.infer<typeof uploadBatchSchema>;
export type UploadBatchSlide = z.infer<typeof uploadBatchSlideSchema>;
export type UploadBatchResult = z.infer<typeof uploadBatchResultSchema>;
export type UploadProblem = z.infer<typeof uploadProblemSchema>;

export const getGetUploadBatchUrl = (projectId: string) =>
  `/api/projects/${projectId}/upload-batch`;

const draft = defineDraftQuery("getUploadBatch", getGetUploadBatchUrl, uploadBatchSchema);

export type getUploadBatchResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetUploadBatchQueryResult = getUploadBatchResponse;
export type GetUploadBatchQueryError = Problem;

export const getUploadBatch = (projectId: string, options?: DraftRequest) =>
  draft.fetcher([projectId], options);

export const getGetUploadBatchQueryKey = (projectId: string) => draft.queryKey(projectId);

export const getGetUploadBatchQueryOptions = <TData = getUploadBatchResponse, TError = Problem>(
  projectId: string,
  options?: DraftQueryOptions<getUploadBatchResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([projectId], options);

export const useGetUploadBatch = <TData = getUploadBatchResponse, TError = Problem>(
  projectId: string,
  options?: DraftQueryOptions<getUploadBatchResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([projectId], options, queryClient);
