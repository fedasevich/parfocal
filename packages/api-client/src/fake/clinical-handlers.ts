import type { RequestHandler } from "msw";
import {
  getCosignClinicalReportMockHandler,
  getGetClinicalReportMockHandler,
  getGetCosignReviewMockHandler,
  getReturnCosignRequestMockHandler,
} from "../generated/api.msw.ts";
import type { ClinicalReport, ClinicalSignature, CosignReview } from "../generated/api.ts";
import { people } from "./scenario.ts";
import {
  type ClinicalCase,
  canSignCase,
  clinicalCaseForSlide,
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
  return {
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
    members: Object.entries(clinicalRoles).map(([key, role]) => ({
      user_id: people[key as keyof typeof people].id,
      role,
      sign_out: role === "viewer" ? "never" : (signRights[key] ?? "never"),
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
  };
};

export const toCosignReview = (): CosignReview => {
  const item = clinicalCaseForSlide("");
  const template = clinicalTemplates[item.template];
  const viewer = fakeView().viewer;
  return {
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
  };
};

const signedAt = "2026-10-15T11:42:00+02:00";

const signature = (version: number, reportedBy: string | null): ClinicalSignature => ({
  version,
  signed_by_user_id: people[fakeView().viewer].id,
  reported_by_user_id: reportedBy,
  signed_at: signedAt,
});

export const clinicalReportHandlers = (): RequestHandler[] => [
  getGetClinicalReportMockHandler(({ params }) => toClinicalReport(String(params.slideId))),
  getGetCosignReviewMockHandler(() => toCosignReview()),
  getReturnCosignRequestMockHandler(async ({ request }) => {
    const body = (await request.json()) as { note?: string };
    return {
      id: cosignSent.id,
      note: body.note ?? "",
      returned_at: "2026-10-15T11:35:00+02:00",
    };
  }),
  getCosignClinicalReportMockHandler(() => signature(1, people[cosignSent.from].id)),
];
