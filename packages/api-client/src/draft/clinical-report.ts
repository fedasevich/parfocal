import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { type Problem, SignOutRight } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";

export const ClinicalCategory = { macro: "macro", micro: "micro", itc: "itc" } as const;
export const ExtranodalExtension = { present: "present", absent: "absent", na: "na" } as const;
export const ClinicalStep = {
  findings: "findings",
  staging: "staging",
  text: "text",
  sign: "sign",
} as const;

export const clinicalDepositSchema = z.object({
  id: z.string(),
  slide: z.string(),
  object_id: z.string().nullable(),
  size_mm: z.string(),
  note: z.string(),
});

export type ClinicalDeposit = z.infer<typeof clinicalDepositSchema>;

export const clinicalValuesSchema = z.object({
  specimen: z.string(),
  deposits: z.array(clinicalDepositSchema),
  category: z.enum(ClinicalCategory).nullable(),
  examined: z.string(),
  extranodal: z.enum(ExtranodalExtension).nullable(),
  diagnosis: z.string().nullable(),
  microscopic: z.string(),
  comment: z.string(),
});

export type ClinicalValues = z.infer<typeof clinicalValuesSchema>;

const projectRefSchema = z.object({ id: z.string(), code: z.string(), name: z.string() });

export const clinicalReportSchema = z.object({
  id: z.string(),
  project: projectRefSchema,
  case: z.object({
    label: z.string(),
    site: z.string(),
    clinical_history: z.string(),
    received: z.string(),
    requested_by: z.string(),
    assigned_user_ids: z.array(z.string()),
    examined: z.number().int().nullable(),
    cells: z.object({ agree: z.number().int(), of: z.number().int() }).nullable(),
  }),
  template: z.object({
    key: z.string(),
    name: z.string(),
    version: z.string(),
    steps: z.array(z.object({ key: z.enum(ClinicalStep), label: z.string() })),
    standards: z.array(z.tuple([z.string(), z.string()])),
  }),
  slide: z.string(),
  slides: z.array(
    z.object({
      key: z.string(),
      id: z.string(),
      label: z.string(),
      node: z.number().int(),
      short: z.string(),
    }),
  ),
  decisions: z.array(
    z.object({
      object_id: z.string(),
      counts_as: z.enum(["agree", "disagree", "unsure"]),
      why: z.string(),
    }),
  ),
  objects: z.array(
    z.object({
      slide: z.string(),
      object_id: z.string(),
      size_mm: z.number(),
      ai_size_mm: z.number(),
      measured_by: z.enum(["you", "ai"]),
      state: z.enum(["agree", "disagree", "open"]),
    }),
  ),
  members: z.array(
    z.object({
      user_id: z.string(),
      role: z.enum(["owner", "reviewer", "viewer"]),
      sign_out: z.enum(SignOutRight),
      covers_case: z.boolean(),
    }),
  ),
  author_user_id: z.string(),
  values: clinicalValuesSchema,
});

export type ClinicalReport = z.infer<typeof clinicalReportSchema>;

export const getGetClinicalReportUrl = (projectId: string, slideId: string) =>
  `/api/projects/${projectId}/slides/${slideId}/clinical-report`;

const reportDraft = defineDraftQuery(
  "getClinicalReport",
  getGetClinicalReportUrl,
  clinicalReportSchema,
);

export type getClinicalReportResponse = Awaited<ReturnType<typeof reportDraft.fetcher>>;
export type GetClinicalReportQueryResult = getClinicalReportResponse;
export type GetClinicalReportQueryError = Problem;

export const getClinicalReport = (projectId: string, slideId: string, options?: DraftRequest) =>
  reportDraft.fetcher([projectId, slideId], options);

export const getGetClinicalReportQueryKey = (projectId: string, slideId: string) =>
  reportDraft.queryKey(projectId, slideId);

export const getGetClinicalReportQueryOptions = <
  TData = getClinicalReportResponse,
  TError = Problem,
>(
  projectId: string,
  slideId: string,
  options?: DraftQueryOptions<getClinicalReportResponse, TData, TError>,
) => reportDraft.queryOptions<TData, TError>([projectId, slideId], options);

export const useGetClinicalReport = <TData = getClinicalReportResponse, TError = Problem>(
  projectId: string,
  slideId: string,
  options?: DraftQueryOptions<getClinicalReportResponse, TData, TError>,
  queryClient?: QueryClient,
) => reportDraft.useDraftQuery<TData, TError>([projectId, slideId], options, queryClient);

export const cosignReviewSchema = z.object({
  id: z.string(),
  project: projectRefSchema,
  case_label: z.string(),
  template: z.object({ name: z.string(), version: z.string() }),
  from_user_id: z.string(),
  to_user_id: z.string(),
  sent_at: z.iso.datetime({ offset: true }),
  values: clinicalValuesSchema,
  slides: z.array(z.object({ key: z.string(), node: z.number().int(), short: z.string() })),
  ai: z.object({
    largest_mm: z.number(),
    deposits: z.array(z.object({ slide: z.string(), object_id: z.string(), size_mm: z.number() })),
  }),
  co_signer_covers_case: z.boolean(),
});

export type CosignReview = z.infer<typeof cosignReviewSchema>;

export const getGetCosignReviewUrl = (projectId: string, slideId: string) =>
  `/api/projects/${projectId}/slides/${slideId}/clinical-report/cosign-request`;

const cosignDraft = defineDraftQuery("getCosignReview", getGetCosignReviewUrl, cosignReviewSchema);

export type getCosignReviewResponse = Awaited<ReturnType<typeof cosignDraft.fetcher>>;
export type GetCosignReviewQueryResult = getCosignReviewResponse;
export type GetCosignReviewQueryError = Problem;

export const getCosignReview = (projectId: string, slideId: string, options?: DraftRequest) =>
  cosignDraft.fetcher([projectId, slideId], options);

export const getGetCosignReviewQueryKey = (projectId: string, slideId: string) =>
  cosignDraft.queryKey(projectId, slideId);

export const getGetCosignReviewQueryOptions = <TData = getCosignReviewResponse, TError = Problem>(
  projectId: string,
  slideId: string,
  options?: DraftQueryOptions<getCosignReviewResponse, TData, TError>,
) => cosignDraft.queryOptions<TData, TError>([projectId, slideId], options);

export const useGetCosignReview = <TData = getCosignReviewResponse, TError = Problem>(
  projectId: string,
  slideId: string,
  options?: DraftQueryOptions<getCosignReviewResponse, TData, TError>,
  queryClient?: QueryClient,
) => cosignDraft.useDraftQuery<TData, TError>([projectId, slideId], options, queryClient);

export const clinicalSignatureSchema = z.object({
  version: z.number().int().positive(),
  signed_by_user_id: z.string(),
  reported_by_user_id: z.string().nullable(),
  signed_at: z.iso.datetime({ offset: true }),
});

export type ClinicalSignature = z.infer<typeof clinicalSignatureSchema>;

export type ClinicalReportTarget = { projectId: string; slideId: string };

export const cosignReturnSchema = z.object({
  id: z.string(),
  note: z.string(),
  returned_at: z.iso.datetime({ offset: true }),
});

export type CosignReturn = z.infer<typeof cosignReturnSchema>;

export type ReturnCosignRequestMutationVariables = ClinicalReportTarget & {
  data: { note: string; values: ClinicalValues };
};

export const getReturnCosignRequestUrl = (projectId: string, slideId: string) =>
  `${getGetCosignReviewUrl(projectId, slideId)}/return`;

const returnDraft = defineDraftMutation(
  "returnCosignRequest",
  {
    method: "POST",
    url: ({ projectId, slideId }: ReturnCosignRequestMutationVariables) =>
      getReturnCosignRequestUrl(projectId, slideId),
    body: ({ data }) => data,
  },
  cosignReturnSchema,
);

export type returnCosignRequestResponse = Awaited<ReturnType<typeof returnDraft.fetcher>>;
export type ReturnCosignRequestMutationResult = returnCosignRequestResponse;
export type ReturnCosignRequestMutationError = Problem;

export const returnCosignRequest = (
  variables: ReturnCosignRequestMutationVariables,
  options?: DraftRequest,
) => returnDraft.fetcher(variables, options);

export const getReturnCosignRequestMutationKey = () => returnDraft.mutationKey();

export const getReturnCosignRequestMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    returnCosignRequestResponse,
    ReturnCosignRequestMutationVariables,
    TError,
    TContext
  >,
) => returnDraft.mutationOptions<TError, TContext>(options);

export const useReturnCosignRequest = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    returnCosignRequestResponse,
    ReturnCosignRequestMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => returnDraft.useDraftMutation<TError, TContext>(options, queryClient);

export type CosignClinicalReportMutationVariables = ClinicalReportTarget & {
  data: { method: "sso" | "password"; values: ClinicalValues };
};

export const getCosignClinicalReportUrl = (projectId: string, slideId: string) =>
  `${getGetCosignReviewUrl(projectId, slideId)}/co-sign`;

const cosignSignDraft = defineDraftMutation(
  "cosignClinicalReport",
  {
    method: "POST",
    url: ({ projectId, slideId }: CosignClinicalReportMutationVariables) =>
      getCosignClinicalReportUrl(projectId, slideId),
    body: ({ data }) => data,
  },
  clinicalSignatureSchema,
);

export type cosignClinicalReportResponse = Awaited<ReturnType<typeof cosignSignDraft.fetcher>>;
export type CosignClinicalReportMutationResult = cosignClinicalReportResponse;
export type CosignClinicalReportMutationError = Problem;

export const cosignClinicalReport = (
  variables: CosignClinicalReportMutationVariables,
  options?: DraftRequest,
) => cosignSignDraft.fetcher(variables, options);

export const getCosignClinicalReportMutationKey = () => cosignSignDraft.mutationKey();

export const getCosignClinicalReportMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    cosignClinicalReportResponse,
    CosignClinicalReportMutationVariables,
    TError,
    TContext
  >,
) => cosignSignDraft.mutationOptions<TError, TContext>(options);

export const useCosignClinicalReport = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    cosignClinicalReportResponse,
    CosignClinicalReportMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => cosignSignDraft.useDraftMutation<TError, TContext>(options, queryClient);
