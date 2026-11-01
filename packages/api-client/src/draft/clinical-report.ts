import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
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
export const SignOutRight = { own: "own", any: "any", never: "never" } as const;

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

export const clinicalReportRowSchema = z.object({
  case_label: z.string(),
  slide_id: z.string(),
  template: z.string(),
  has_staging: z.boolean(),
});

export type ClinicalReportRow = z.infer<typeof clinicalReportRowSchema>;

export const getListClinicalReportsUrl = (projectId: string) =>
  `/api/projects/${projectId}/clinical-reports`;

const listDraft = defineDraftQuery(
  "listClinicalReports",
  getListClinicalReportsUrl,
  z.array(clinicalReportRowSchema),
);

export type listClinicalReportsResponse = Awaited<ReturnType<typeof listDraft.fetcher>>;
export type ListClinicalReportsQueryResult = listClinicalReportsResponse;
export type ListClinicalReportsQueryError = Problem;

export const listClinicalReports = (projectId: string, options?: DraftRequest) =>
  listDraft.fetcher([projectId], options);

export const getListClinicalReportsQueryKey = (projectId: string) => listDraft.queryKey(projectId);

export const getListClinicalReportsQueryOptions = <
  TData = listClinicalReportsResponse,
  TError = Problem,
>(
  projectId: string,
  options?: DraftQueryOptions<listClinicalReportsResponse, TData, TError>,
) => listDraft.queryOptions<TData, TError>([projectId], options);

export const useListClinicalReports = <TData = listClinicalReportsResponse, TError = Problem>(
  projectId: string,
  options?: DraftQueryOptions<listClinicalReportsResponse, TData, TError>,
  queryClient?: QueryClient,
) => listDraft.useDraftQuery<TData, TError>([projectId], options, queryClient);

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

export type SignOutClinicalReportMutationVariables = ClinicalReportTarget & {
  data: { method: "sso" | "password"; values: ClinicalValues };
};

export const getSignOutClinicalReportUrl = (projectId: string, slideId: string) =>
  `${getGetClinicalReportUrl(projectId, slideId)}/sign-out`;

const signOutDraft = defineDraftMutation(
  "signOutClinicalReport",
  {
    method: "POST",
    url: ({ projectId, slideId }: SignOutClinicalReportMutationVariables) =>
      getSignOutClinicalReportUrl(projectId, slideId),
    body: ({ data }) => data,
  },
  clinicalSignatureSchema,
);

export type signOutClinicalReportResponse = Awaited<ReturnType<typeof signOutDraft.fetcher>>;
export type SignOutClinicalReportMutationResult = signOutClinicalReportResponse;
export type SignOutClinicalReportMutationError = Problem;

export const signOutClinicalReport = (
  variables: SignOutClinicalReportMutationVariables,
  options?: DraftRequest,
) => signOutDraft.fetcher(variables, options);

export const getSignOutClinicalReportMutationKey = () => signOutDraft.mutationKey();

export const getSignOutClinicalReportMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    signOutClinicalReportResponse,
    SignOutClinicalReportMutationVariables,
    TError,
    TContext
  >,
) => signOutDraft.mutationOptions<TError, TContext>(options);

export const useSignOutClinicalReport = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    signOutClinicalReportResponse,
    SignOutClinicalReportMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => signOutDraft.useDraftMutation<TError, TContext>(options, queryClient);

export const cosignRequestSentSchema = z.object({
  id: z.string(),
  to_user_id: z.string(),
  sent_at: z.iso.datetime({ offset: true }),
});

export type CosignRequestSent = z.infer<typeof cosignRequestSentSchema>;

export type SendClinicalReportForCosignMutationVariables = ClinicalReportTarget & {
  data: { cosigner_user_id: string; values: ClinicalValues };
};

export const getSendClinicalReportForCosignUrl = (projectId: string, slideId: string) =>
  `${getGetClinicalReportUrl(projectId, slideId)}/cosign-requests`;

const sendDraft = defineDraftMutation(
  "sendClinicalReportForCosign",
  {
    method: "POST",
    url: ({ projectId, slideId }: SendClinicalReportForCosignMutationVariables) =>
      getSendClinicalReportForCosignUrl(projectId, slideId),
    body: ({ data }) => data,
  },
  cosignRequestSentSchema,
);

export type sendClinicalReportForCosignResponse = Awaited<ReturnType<typeof sendDraft.fetcher>>;
export type SendClinicalReportForCosignMutationResult = sendClinicalReportForCosignResponse;
export type SendClinicalReportForCosignMutationError = Problem;

export const sendClinicalReportForCosign = (
  variables: SendClinicalReportForCosignMutationVariables,
  options?: DraftRequest,
) => sendDraft.fetcher(variables, options);

export const getSendClinicalReportForCosignMutationKey = () => sendDraft.mutationKey();

export const getSendClinicalReportForCosignMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    sendClinicalReportForCosignResponse,
    SendClinicalReportForCosignMutationVariables,
    TError,
    TContext
  >,
) => sendDraft.mutationOptions<TError, TContext>(options);

export const useSendClinicalReportForCosign = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    sendClinicalReportForCosignResponse,
    SendClinicalReportForCosignMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => sendDraft.useDraftMutation<TError, TContext>(options, queryClient);

export type WithdrawCosignRequestMutationVariables = ClinicalReportTarget & { requestId: string };

export const getWithdrawCosignRequestUrl = (
  projectId: string,
  slideId: string,
  requestId: string,
) => `${getSendClinicalReportForCosignUrl(projectId, slideId)}/${requestId}`;

const withdrawDraft = defineDraftMutation(
  "withdrawCosignRequest",
  {
    method: "DELETE",
    url: ({ projectId, slideId, requestId }: WithdrawCosignRequestMutationVariables) =>
      getWithdrawCosignRequestUrl(projectId, slideId, requestId),
  },
  z.undefined(),
);

export type withdrawCosignRequestResponse = Awaited<ReturnType<typeof withdrawDraft.fetcher>>;
export type WithdrawCosignRequestMutationResult = withdrawCosignRequestResponse;
export type WithdrawCosignRequestMutationError = Problem;

export const withdrawCosignRequest = (
  variables: WithdrawCosignRequestMutationVariables,
  options?: DraftRequest,
) => withdrawDraft.fetcher(variables, options);

export const getWithdrawCosignRequestMutationKey = () => withdrawDraft.mutationKey();

export const getWithdrawCosignRequestMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    withdrawCosignRequestResponse,
    WithdrawCosignRequestMutationVariables,
    TError,
    TContext
  >,
) => withdrawDraft.mutationOptions<TError, TContext>(options);

export const useWithdrawCosignRequest = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    withdrawCosignRequestResponse,
    WithdrawCosignRequestMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => withdrawDraft.useDraftMutation<TError, TContext>(options, queryClient);

export type AmendClinicalReportMutationVariables = ClinicalReportTarget & {
  data: { reason: string; values: ClinicalValues };
};

export const getAmendClinicalReportUrl = (projectId: string, slideId: string) =>
  `${getGetClinicalReportUrl(projectId, slideId)}/amendments`;

const amendDraft = defineDraftMutation(
  "amendClinicalReport",
  {
    method: "POST",
    url: ({ projectId, slideId }: AmendClinicalReportMutationVariables) =>
      getAmendClinicalReportUrl(projectId, slideId),
    body: ({ data }) => data,
  },
  clinicalSignatureSchema,
);

export type amendClinicalReportResponse = Awaited<ReturnType<typeof amendDraft.fetcher>>;
export type AmendClinicalReportMutationResult = amendClinicalReportResponse;
export type AmendClinicalReportMutationError = Problem;

export const amendClinicalReport = (
  variables: AmendClinicalReportMutationVariables,
  options?: DraftRequest,
) => amendDraft.fetcher(variables, options);

export const getAmendClinicalReportMutationKey = () => amendDraft.mutationKey();

export const getAmendClinicalReportMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    amendClinicalReportResponse,
    AmendClinicalReportMutationVariables,
    TError,
    TContext
  >,
) => amendDraft.mutationOptions<TError, TContext>(options);

export const useAmendClinicalReport = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    amendClinicalReportResponse,
    AmendClinicalReportMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => amendDraft.useDraftMutation<TError, TContext>(options, queryClient);

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
