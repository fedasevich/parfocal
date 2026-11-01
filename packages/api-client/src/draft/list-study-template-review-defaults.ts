import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const ScopeKindKey = {
  regions: "regions",
  cells: "cells",
  low: "low",
  roi: "roi",
  unsure: "unsure",
} as const;

export const DecisionKind = {
  certainty5: "certainty5",
  agree: "agree",
  yesno: "yesno",
  blind: "blind",
} as const;

export const displayDefaultsSchema = z.object({
  draw: z.enum(["outline", "fill", "dots"]),
  width: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  opacity: z.number().int().min(20).max(100),
  colorBy: z.enum(["class", "score", "decision"]),
  ids: z.boolean(),
  conf: z.enum(["number", "word", "color", "hidden"]),
  heat: z.number().int().min(0).max(100),
  cutoff: z.number().min(0).max(1),
  sets: z.object({ cam: z.boolean(), sam: z.boolean(), rev: z.boolean() }),
  order: z.enum(["ai", "size", "leastsure", "random"]),
  zoom: z.enum(["fit", "tight", "context"]),
  auto: z.boolean(),
  buttons: z.enum(["right", "bottom"]),
});

export type DisplayDefaults = z.infer<typeof displayDefaultsSchema>;

export const opinionFormChoiceSchema = z.object({
  key: z.string(),
  name: z.string(),
  questions: z.array(
    z.object({
      label: z.string(),
      kind: z.enum(["scale", "choice", "yesno", "text"]),
      required: z.boolean(),
    }),
  ),
});

export type OpinionFormChoice = z.infer<typeof opinionFormChoiceSchema>;

export const studyTemplateReviewDefaultsSchema = z.object({
  templates: z.array(
    z.object({
      template_id: z.string(),
      scope_kinds: z.array(z.enum(ScopeKindKey)),
      scope_options: z.object({
        cells: z.number().int(),
        low: z.number(),
        rois: z.array(z.string()),
        unsure_zones: z.array(z.string()),
      }),
      decision: z.object({
        kind: z.enum(DecisionKind),
        agree_from: z.number().int().min(2).max(5),
        disagree_to: z.number().int().min(1).max(4),
      }),
      display: displayDefaultsSchema,
      opinion_form: z.string(),
    }),
  ),
  opinion_forms: z.array(opinionFormChoiceSchema),
});

export type StudyTemplateReviewDefaults = z.infer<typeof studyTemplateReviewDefaultsSchema>;

export const getListStudyTemplateReviewDefaultsUrl = () => "/api/study-templates/review-defaults";

const draft = defineDraftQuery(
  "listStudyTemplateReviewDefaults",
  getListStudyTemplateReviewDefaultsUrl,
  studyTemplateReviewDefaultsSchema,
);

export type listStudyTemplateReviewDefaultsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListStudyTemplateReviewDefaultsQueryResult = listStudyTemplateReviewDefaultsResponse;
export type ListStudyTemplateReviewDefaultsQueryError = Problem;

export const listStudyTemplateReviewDefaults = (options?: DraftRequest) =>
  draft.fetcher([], options);

export const getListStudyTemplateReviewDefaultsQueryKey = () => draft.queryKey();

export const getListStudyTemplateReviewDefaultsQueryOptions = <
  TData = listStudyTemplateReviewDefaultsResponse,
  TError = Problem,
>(
  options?: DraftQueryOptions<listStudyTemplateReviewDefaultsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useListStudyTemplateReviewDefaults = <
  TData = listStudyTemplateReviewDefaultsResponse,
  TError = Problem,
>(
  options?: DraftQueryOptions<listStudyTemplateReviewDefaultsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
