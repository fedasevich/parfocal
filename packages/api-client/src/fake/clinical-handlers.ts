import { HttpResponse, http } from "msw";
import {
  type ClinicalReport,
  type ClinicalSignature,
  type CosignReturn,
  type CosignReview,
  clinicalReportSchema,
  cosignReviewSchema,
} from "../draft/clinical-report.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { people } from "./scenario.ts";
import {
  type ClinicalCase,
  canSignCase,
  clinicalCaseForSlide,
  clinicalCases,
  clinicalProjectRef,
  clinicalRoles,
  clinicalTemplates,
  cosignSent,
  nodeStandards,
  signRights,
} from "./scenario-clinical.ts";
import { fakeView } from "./view.ts";

const reportId = (item: ClinicalCase) => `clinical-report-${item.label}`;

export const toClinicalReport = (slideId: string): ClinicalReport => {
  const item = clinicalCaseForSlide(slideId);
  const viewer = fakeView().viewer;
  const template = clinicalTemplates[item.template];
  const seeds = item.deposits[viewer] ?? item.deposits.LM ?? [];
  return clinicalReportSchema.parse({
    id: reportId(item),
    project: clinicalProjectRef(),
    case: {
      label: item.label,
      site: item.site,
      clinical_history: item.clinical,
      received: item.receivedAt,
      requested_by: item.requestedBy,
      assigned_user_ids: item.assigned.map((key) => people[key].id),
      examined: item.examined,
      cells: item.cells,
    },
    template: {
      key: item.template,
      name: template.name,
      version: template.version,
      steps: template.steps,
      standards: item.template === "sentinel-node" ? nodeStandards : [],
    },
    slide: item.slide,
    slides: item.slides,
    decisions: item.decisions.map((decision) => ({
      object_id: decision.objectId,
      counts_as: decision.count,
      why: decision.why,
    })),
    objects: item.objects.map((object) => ({
      slide: object.slide,
      object_id: object.objectId,
      size_mm: object.sizeMm,
      ai_size_mm: object.aiSizeMm,
      measured_by: object.by,
      state: object.state,
    })),
    members: Object.keys(clinicalRoles).map((key) => ({
      user_id: people[key as keyof typeof people].id,
      role: clinicalRoles[key],
      sign_out: clinicalRoles[key] === "viewer" ? "never" : signRights[key],
      covers_case: canSignCase(key, item),
    })),
    author_user_id: people[viewer].id,
    values: {
      specimen: item.specimen,
      deposits: seeds.map((seed, index) => ({
        id: `D${index + 1}`,
        slide: seed.slide,
        object_id: seed.objectId,
        size_mm: seed.sizeMm,
        note: "",
      })),
      category: null,
      examined: item.examined === null ? "" : String(item.examined),
      extranodal: null,
      diagnosis: null,
      microscopic: viewer === "TB" ? cosignSent.values.microscopic : "",
      comment: "",
    },
  });
};

export const toCosignReview = (): CosignReview => {
  const item = clinicalCaseForSlide("");
  const template = clinicalTemplates[item.template];
  const viewer = fakeView().viewer;
  return cosignReviewSchema.parse({
    id: cosignSent.id,
    project: clinicalProjectRef(),
    case_label: cosignSent.caseLabel,
    template: { name: template.name, version: template.version },
    from_user_id: people[cosignSent.from].id,
    to_user_id: people[cosignSent.to].id,
    sent_at: cosignSent.sentAt,
    values: cosignSent.values,
    slides: item.slides.map((slide) => ({ key: slide.key, node: slide.node, short: slide.short })),
    ai: {
      largest_mm: Math.max(...item.objects.map((object) => object.aiSizeMm)),
      deposits: item.objects.map((object) => ({
        slide: object.slide,
        object_id: object.objectId,
        size_mm: object.aiSizeMm,
      })),
    },
    co_signer_covers_case: canSignCase(viewer, item),
  });
};

const signedAt = "2026-10-15T11:42:00+02:00";

const signature = (version: number, reportedBy: string | null): ClinicalSignature => ({
  version,
  signed_by_user_id: people[fakeView().viewer].id,
  reported_by_user_id: reportedBy,
  signed_at: signedAt,
});

const reportPath = "*/api/projects/:projectId/slides/:slideId/clinical-report";

export const getGetClinicalReportMockHandler = (overrideResponse?: ClinicalReport) =>
  http.get<{ projectId: string; slideId: string }>(reportPath, ({ params }) =>
    HttpResponse.json(overrideResponse ?? toClinicalReport(params.slideId)),
  );

export const getGetCosignReviewMockHandler = (overrideResponse?: CosignReview) =>
  http.get(`${reportPath}/cosign-request`, () =>
    HttpResponse.json(overrideResponse ?? toCosignReview()),
  );

export const getReturnCosignRequestMockHandler = (overrideResponse?: CosignReturn) =>
  http.post(`${reportPath}/cosign-request/return`, async ({ request }) => {
    const body = (await request.json()) as { note?: string };
    const returned: CosignReturn = overrideResponse ?? {
      id: cosignSent.id,
      note: body.note ?? "",
      returned_at: "2026-10-15T11:35:00+02:00",
    };
    return HttpResponse.json(returned, { status: 201 });
  });

export const getCosignClinicalReportMockHandler = (overrideResponse?: ClinicalSignature) =>
  http.post(`${reportPath}/cosign-request/co-sign`, () =>
    HttpResponse.json(overrideResponse ?? signature(1, people[cosignSent.from].id), {
      status: 201,
    }),
  );

const reportApi = "/api/projects/{project_id}/slides/{slide_id}/clinical-report";

export const clinicalDraftOperations: DraftOperation[] = [
  {
    operationId: "getClinicalReport",
    method: "get",
    path: reportApi,
    handler: () => getGetClinicalReportMockHandler(),
  },
  {
    operationId: "getCosignReview",
    method: "get",
    path: `${reportApi}/cosign-request`,
    handler: () => getGetCosignReviewMockHandler(),
  },
  {
    operationId: "returnCosignRequest",
    method: "post",
    path: `${reportApi}/cosign-request/return`,
    handler: () => getReturnCosignRequestMockHandler(),
  },
  {
    operationId: "cosignClinicalReport",
    method: "post",
    path: `${reportApi}/cosign-request/co-sign`,
    handler: () => getCosignClinicalReportMockHandler(),
  },
];
