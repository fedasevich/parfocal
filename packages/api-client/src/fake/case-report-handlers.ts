import { HttpResponse, http, type RequestHandler } from "msw";
import type {
  CaseReport,
  CaseReportAmendment,
  CaseReportBlocker,
  CaseReportChange,
  CaseReportCosign,
  CaseReportDeposit,
  CaseReportSignature,
  CaseReportSignOut,
  CaseReportStaging,
  CaseReportValues,
  CosignRequest,
  NewCaseReportDeposit,
  NodeCategory,
} from "../generated/api.ts";
import { cases, people, slides } from "./scenario.ts";
import {
  type ClinicalCase,
  clinicalCases,
  clinicalProject,
  clinicalProjectRef,
  clinicalTemplates,
  cosignSent,
} from "./scenario-clinical.ts";
import { fakeView } from "./view.ts";

type StoredDeposit = Omit<CaseReportDeposit, "largest">;

type Stored = {
  caseLabel: string;
  state: CaseReport["state"];
  specimen: string | null;
  category: NodeCategory | null;
  confirmedAgainst: NodeCategory | null;
  nodesExamined: number | null;
  extranodal: CaseReport["extranodal"];
  diagnosis: string | null;
  microscopic: string | null;
  comment: string | null;
  deposits: StoredDeposit[];
  cosigner: string | null;
  sentBy: string | null;
  sent?: StoredValues | null;
  sentAt?: string | null;
  returnNote?: string | null;
  versions: { signature: CaseReportSignature; values: StoredValues }[];
  next: number;
};

type StoredValues = Pick<
  Stored,
  | "specimen"
  | "category"
  | "nodesExamined"
  | "extranodal"
  | "diagnosis"
  | "microscopic"
  | "comment"
  | "deposits"
>;

const storageKey = "parfocal.fake.case-reports";
let memory = new Map<string, Stored>();

const local = (): Storage | null => (typeof localStorage === "undefined" ? null : localStorage);

function readStore(): Map<string, Stored> {
  const stored = local()?.getItem(storageKey);
  if (stored == null) return memory;
  return new Map(JSON.parse(stored) as [string, Stored][]);
}

function writeStore(store: Map<string, Stored>): void {
  memory = store;
  local()?.setItem(storageKey, JSON.stringify([...store]));
}

export function resetFakeCaseReports(): void {
  memory = new Map();
  local()?.removeItem(storageKey);
}

const problem = (status: number, code: string, title: string) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const sizeOf = (size: string) => Number(size);

const categoryOf = (mm: number): NodeCategory => (mm > 2 ? "macro" : mm > 0.2 ? "micro" : "itc");

const nodeOf = (label: string) => Number(/\d+/.exec(label)?.[0] ?? 1);

const slideIdOf = (item: ClinicalCase, key: string) =>
  slides.find((slide) => slide.caseLabel === item.label && slide.label === key)?.id ??
  slides.find((slide) => slide.caseLabel === item.label)?.id ??
  "";

export const clinicalCaseOf = (caseId: string): ClinicalCase | undefined => {
  const found = cases.find((item) => item.id === caseId);
  if (found === undefined) return undefined;
  if (found.project !== clinicalProject)
    return clinicalCases.find((item) => item.label === found.label);
  const siblings = cases.filter((item) => item.project === clinicalProject);
  return clinicalCases[siblings.indexOf(found)];
};

const caseItem = clinicalCaseOf;

export const clinicalCaseId = (label: string) =>
  cases.find((item) => item.label === label && item.project === clinicalProject)?.id;

const seedOf = (item: ClinicalCase): Stored => {
  const viewer = fakeView().viewer;
  const seeds = item.deposits[viewer] ?? item.deposits.LM ?? [];
  return {
    caseLabel: item.label,
    state: "draft",
    specimen: item.specimen,
    category: null,
    confirmedAgainst: null,
    nodesExamined: item.examined,
    extranodal: null,
    diagnosis: null,
    microscopic: null,
    comment: null,
    deposits: seeds.map((seed, index) => ({
      id: `fake-deposit-${item.label}-${index + 1}`,
      slide_id: slideIdOf(item, seed.slide),
      object_id: seed.objectId,
      size_mm: sizeOf(seed.sizeMm),
      note: null,
    })),
    cosigner: null,
    sentBy: null,
    versions: [],
    next: seeds.length + 1,
  };
};

const largestOf = (deposits: StoredDeposit[]) =>
  deposits
    .filter((deposit) => deposit.size_mm !== null)
    .reduce<StoredDeposit | null>(
      (best, deposit) =>
        best === null || (deposit.size_mm ?? 0) > (best.size_mm ?? 0) ? deposit : best,
      null,
    );

const pnOf: Record<NodeCategory, string> = {
  none: "pN0",
  macro: "pN1a(sn)",
  micro: "pN1mi(sn)",
  itc: "pN0(i+)(sn)",
};

const stagingOf = (stored: Stored, staged: boolean): CaseReportStaging | null => {
  if (!staged) return null;
  const largest = largestOf(stored.deposits);
  const suggested: NodeCategory = largest ? categoryOf(largest.size_mm ?? 0) : "none";
  const contradicts = stored.category !== null && stored.category !== suggested;
  return {
    largest_mm: largest?.size_mm ?? null,
    suggested_category: suggested,
    suggested_pn: pnOf[stored.category ?? suggested],
    nodes_positive: new Set(stored.deposits.map((deposit) => deposit.slide_id)).size,
    contradicts,
    confirmed: !contradicts || stored.confirmedAgainst === suggested,
  };
};

const blockersOf = (stored: Stored, staging: CaseReportStaging | null): CaseReportBlocker[] => {
  const found: CaseReportBlocker[] = [];
  if (!(stored.specimen ?? "").trim())
    found.push({ code: "required-field-empty", field: "specimen" });
  if (!(stored.diagnosis ?? "").trim())
    found.push({ code: "required-field-empty", field: "diagnosis" });
  if (staging === null) return found;
  if (stored.category === null) found.push({ code: "required-field-empty", field: "category" });
  if (stored.nodesExamined === null)
    found.push({ code: "required-field-empty", field: "nodes_examined" });
  if (stored.extranodal === null) found.push({ code: "required-field-empty", field: "extranodal" });
  for (const deposit of stored.deposits) {
    if (deposit.size_mm === null)
      found.push({ code: "deposit-without-size", deposit_id: deposit.id });
  }
  if (!staging.confirmed) found.push({ code: "category-not-confirmed", field: "category" });
  return found;
};

const scenarioSent = (stored: Stored, item: ClinicalCase): StoredValues | null => {
  if (item.label !== cosignSent.caseLabel || stored.state !== "draft" || stored.sent) return null;
  const values = cosignSent.values;
  return {
    specimen: values.specimen,
    category: values.category,
    nodesExamined: Number(values.examined),
    extranodal: values.extranodal,
    diagnosis: values.diagnosis,
    microscopic: values.microscopic,
    comment: trimmed(values.comment),
    deposits: stored.deposits.map((deposit) => {
      const match = values.deposits.find((candidate) => candidate.object_id === deposit.object_id);
      return { ...deposit, size_mm: match ? sizeOf(match.size_mm) : deposit.size_mm };
    }),
  };
};

const partsOf = (values: StoredValues, largestId: string | undefined): CaseReportValues => ({
  specimen: values.specimen,
  category: values.category,
  nodes_examined: values.nodesExamined,
  extranodal: values.extranodal,
  diagnosis: values.diagnosis,
  microscopic: values.microscopic,
  comment: values.comment,
  deposits: values.deposits.map((deposit) => ({ ...deposit, largest: deposit.id === largestId })),
});

const depositKey = (deposit: StoredDeposit) =>
  `${deposit.slide_id}:${deposit.object_id}:${deposit.size_mm}:${deposit.note}`;

const changesOf = (sent: StoredValues, current: StoredValues): string[] => {
  const pairs: [string, unknown, unknown][] = [
    ["specimen", sent.specimen, current.specimen],
    ["category", sent.category, current.category],
    ["nodes_examined", sent.nodesExamined, current.nodesExamined],
    ["extranodal", sent.extranodal, current.extranodal],
    ["diagnosis", sent.diagnosis, current.diagnosis],
    ["microscopic", sent.microscopic, current.microscopic],
    ["comment", sent.comment, current.comment],
  ];
  const names = pairs.filter(([, before, after]) => before !== after).map(([name]) => name);
  const before = sent.deposits.map(depositKey).sort().join("|");
  const after = current.deposits.map(depositKey).sort().join("|");
  return before === after ? names : [...names, "deposits"];
};

const reportOf = (caseId: string, stored: Stored, item: ClinicalCase): CaseReport => {
  const template = clinicalTemplates[item.template];
  const staged = template.steps.some((step) => step.key === "staging");
  const staging = stagingOf(stored, staged);
  const largest = largestOf(stored.deposits);
  const firstSlide = slideIdOf(item, item.slide);
  const fallback = scenarioSent(stored, item);
  const sent = stored.sent ?? fallback;
  return {
    id: `fake-report-${item.label}`,
    project_id: "",
    case_id: caseId,
    state: stored.state,
    template: {
      key: item.template,
      name: template.name,
      version: Number(template.version.replace(/\D/g, "")),
      steps: template.steps.map((step) => step.key),
    },
    specimen: stored.specimen,
    category: stored.category,
    nodes_examined: stored.nodesExamined,
    extranodal: stored.extranodal,
    diagnosis: stored.diagnosis,
    microscopic: stored.microscopic,
    comment: stored.comment,
    deposits: stored.deposits.map((deposit) => ({
      ...deposit,
      largest: deposit.id === largest?.id,
    })),
    staging,
    findings: {
      decisions: item.decisions.map((decision) => ({
        slide_id: firstSlide,
        object_id: decision.objectId,
        decision: decision.count,
      })),
      measurements: item.objects
        .filter((object) => object.by === "you")
        .map((object) => ({
          slide_id: slideIdOf(item, object.slide),
          object_id: object.objectId,
          length_mm: object.sizeMm,
        })),
    },
    blockers: blockersOf(stored, staging),
    cosigner_user_id: stored.cosigner,
    sent_by_user_id: stored.sentBy ?? (fallback ? people[cosignSent.from].id : null),
    sent_at: stored.sentAt ?? (fallback ? cosignSent.sentAt : null),
    sent: sent
      ? { values: partsOf(sent, largestOf(sent.deposits)?.id), staging: stagingOf(stored, staged) }
      : null,
    changes: sent ? changesOf(sent, valuesOf(stored)) : [],
    return_note: stored.returnNote ?? null,
    version: stored.versions.length || 1,
    versions: stored.versions.map((version) => version.signature),
  };
};

const valuesOf = (stored: Stored): StoredValues => ({
  specimen: stored.specimen,
  category: stored.category,
  nodesExamined: stored.nodesExamined,
  extranodal: stored.extranodal,
  diagnosis: stored.diagnosis,
  microscopic: stored.microscopic,
  comment: stored.comment,
  deposits: stored.deposits.map((deposit) => ({ ...deposit })),
});

const trimmed = (value: string | null | undefined) => {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
};

const applyChange = (stored: Stored, change: CaseReportChange, staged: boolean): string | null => {
  const textFields = ["specimen", "diagnosis", "microscopic", "comment"] as const;
  for (const key of textFields) {
    if (key in change) stored[key] = trimmed(change[key]);
  }
  const stagingFields = ["category", "nodes_examined", "extranodal"] as const;
  if (!staged && stagingFields.some((key) => key in change)) return "no-staging";
  if ("category" in change && (change.category ?? null) !== stored.category) {
    stored.category = change.category ?? null;
    stored.confirmedAgainst = null;
  }
  if ("nodes_examined" in change) stored.nodesExamined = change.nodes_examined ?? null;
  if ("extranodal" in change) stored.extranodal = change.extranodal ?? null;
  if (change.confirm_category)
    stored.confirmedAgainst = stagingOf(stored, staged)?.suggested_category ?? null;
  return null;
};

const withReport = (
  caseId: string,
  act: (stored: Stored, item: ClinicalCase, staged: boolean) => Response | null,
): Response => {
  const item = caseItem(caseId);
  if (item === undefined) return problem(404, "not-found", "Clinical report not found");
  const store = readStore();
  const stored = store.get(caseId) ?? seedOf(item);
  const staged = clinicalTemplates[item.template].steps.some((step) => step.key === "staging");
  const failure = act(stored, item, staged);
  if (failure) return failure;
  store.set(caseId, stored);
  writeStore(store);
  return HttpResponse.json(reportOf(caseId, stored, item), { status: 200 });
};

const viewerId = () => people[fakeView().viewer].id;

const editing = (stored: Stored) =>
  stored.state === "draft" ||
  stored.state === "returned" ||
  (stored.state === "sent" && stored.cosigner === viewerId());

const clearSent = (stored: Stored) => {
  stored.cosigner = null;
  stored.sentBy = null;
  stored.sent = null;
  stored.sentAt = null;
};
const signedState = (stored: Stored) => stored.state === "signed" || stored.state === "amended";

const wrongState = () => problem(409, "wrong-state", "The report cannot change in this state");

const sign = (stored: Stored, state: "signed" | "amended", reason: string | null) => {
  const number = stored.versions.length + 1;
  stored.versions.push({
    signature: {
      number,
      signed_by_user_id: people[fakeView().viewer].id,
      reported_by_user_id: stored.sentBy,
      signed_at: new Date().toISOString(),
      reason,
    },
    values: valuesOf(stored),
  });
  stored.state = state;
};

const base = "*/api/projects/:projectId/cases/:caseId/clinical-report";

export const caseReportHandlers = (): RequestHandler[] => [
  http.get<{ caseId: string }>(base, ({ params }) => withReport(params.caseId, () => null)),
  http.post<{ caseId: string }>(base, ({ params }) => withReport(params.caseId, () => null)),
  http.patch<{ caseId: string }>(base, async ({ params, request }) => {
    const change = (await request.json()) as CaseReportChange;
    return withReport(params.caseId, (stored, _item, staged) => {
      if (!editing(stored)) return wrongState();
      return applyChange(stored, change, staged) === null
        ? null
        : problem(409, "no-staging", "This template has no staging");
    });
  }),
  http.post<{ caseId: string }>(`${base}/deposits`, async ({ params, request }) => {
    const deposit = (await request.json()) as NewCaseReportDeposit;
    return withReport(params.caseId, (stored, item, staged) => {
      if (!editing(stored)) return wrongState();
      if (!staged) return problem(409, "no-staging", "This template has no staging");
      const object = item.objects.find((candidate) => candidate.objectId === deposit.object_id);
      const size = deposit.size_mm ?? (deposit.object_id ? (object?.sizeMm ?? null) : null);
      if (deposit.object_id == null && size === null)
        return problem(409, "size-needed", "A hand measurement needs a size");
      stored.deposits.push({
        id: `fake-deposit-${item.label}-${stored.next}`,
        slide_id: deposit.slide_id,
        object_id: deposit.object_id ?? null,
        size_mm: size,
        note: trimmed(deposit.note),
      });
      stored.next += 1;
      return null;
    });
  }),
  http.delete<{ caseId: string; depositId: string }>(`${base}/deposits/:depositId`, ({ params }) =>
    withReport(params.caseId, (stored) => {
      if (!editing(stored)) return wrongState();
      if (!stored.deposits.some((deposit) => deposit.id === params.depositId))
        return problem(404, "not-found", "Deposit not found");
      stored.deposits = stored.deposits.filter((deposit) => deposit.id !== params.depositId);
      return null;
    }),
  ),
  http.post<{ caseId: string }>(`${base}/send`, async ({ params, request }) => {
    const body = (await request.json()) as CaseReportCosign;
    return withReport(params.caseId, (stored, _item, staged) => {
      if (stored.state !== "draft" && stored.state !== "returned") return wrongState();
      if (blockersOf(stored, stagingOf(stored, staged)).length)
        return problem(409, "report-blocked", "The report has things to finish");
      stored.state = "sent";
      stored.cosigner = body.cosigner_user_id;
      stored.sentBy = viewerId();
      stored.sent = valuesOf(stored);
      stored.sentAt = new Date().toISOString();
      stored.returnNote = null;
      return null;
    });
  }),
  http.post<{ caseId: string }>(`${base}/withdraw`, ({ params }) =>
    withReport(params.caseId, (stored) => {
      if (stored.state !== "sent") return wrongState();
      if (stored.sentBy !== viewerId())
        return problem(403, "not-the-sender", "Only the sender can withdraw the request");
      stored.state = "draft";
      clearSent(stored);
      return null;
    }),
  ),
  http.post<{ caseId: string }>(`${base}/return`, async ({ params, request }) => {
    const body = (await request.json()) as { note: string };
    return withReport(params.caseId, (stored, item) => {
      const scenario = scenarioSent(stored, item);
      if (scenario && viewerId() === people[cosignSent.to].id) {
        stored.state = "sent";
        stored.cosigner = viewerId();
        stored.sentBy = people[cosignSent.from].id;
        stored.sent = scenario;
        stored.sentAt = cosignSent.sentAt;
      }
      if (stored.state !== "sent") return wrongState();
      if (stored.cosigner !== viewerId())
        return problem(403, "not-the-co-signer", "Only the named co-signer can return it");
      stored.state = "returned";
      stored.returnNote = body.note.trim();
      return null;
    });
  }),
  http.post<{ caseId: string }>(`${base}/sign`, async ({ params, request }) => {
    const body = (await request.json().catch(() => null)) as CaseReportSignOut | null;
    return withReport(params.caseId, (stored, _item, staged) => {
      if (signedState(stored)) return wrongState();
      if (blockersOf(stored, stagingOf(stored, staged)).length)
        return problem(409, "report-blocked", "The report has things to finish");
      if (body?.confirmed_with === "sso" && body.identity_answered === false)
        return problem(
          409,
          "single-sign-on-did-not-answer",
          "Single sign-on did not answer, so nothing was signed",
        );
      sign(stored, "signed", null);
      return null;
    });
  }),
  http.get<{ caseId: string; number: string }>(`${base}/versions/:number/pdf`, ({ params }) => {
    const version = readStore().get(params.caseId)?.versions[Number(params.number) - 1];
    if (version === undefined) return problem(404, "not-found", "Version not found");
    return new HttpResponse("%PDF-1.4\n%fake clinical report\n", {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="report_v${params.number}.pdf"`,
      },
    });
  }),
  http.post<{ caseId: string }>(`${base}/amendments`, async ({ params, request }) => {
    const body = (await request.json()) as CaseReportAmendment;
    return withReport(params.caseId, (stored, _item, staged) => {
      if (!signedState(stored)) return wrongState();
      if (applyChange(stored, body.change, staged) !== null)
        return problem(409, "no-staging", "This template has no staging");
      if (blockersOf(stored, stagingOf(stored, staged)).length)
        return problem(409, "report-blocked", "The report has things to finish");
      sign(stored, "amended", body.reason.trim());
      return null;
    });
  }),
  http.get<{ caseId: string; number: string }>(`${base}/versions/:number`, ({ params }) => {
    const item = caseItem(params.caseId);
    const stored = readStore().get(params.caseId);
    const version = stored?.versions[Number(params.number) - 1];
    if (item === undefined || stored === undefined || version === undefined)
      return problem(404, "not-found", "Version not found");
    const shown: Stored = { ...stored, ...version.values };
    const report = reportOf(params.caseId, shown, item);
    return HttpResponse.json({
      ...version.signature,
      values: {
        specimen: report.specimen,
        category: report.category,
        nodes_examined: report.nodes_examined,
        extranodal: report.extranodal,
        diagnosis: report.diagnosis,
        microscopic: report.microscopic,
        comment: report.comment,
        deposits: report.deposits,
      },
      staging: report.staging,
    });
  }),
];

const asksOf = (): CosignRequest[] => {
  const store = readStore();
  const me = viewerId();
  return cases.flatMap(({ id: caseId, project: code }) => {
    const item = code === clinicalProject ? caseItem(caseId) : undefined;
    if (item === undefined) return [];
    const stored = store.get(caseId) ?? seedOf(item);
    const report = reportOf(caseId, stored, item);
    const scenario = report.state === "draft" && me === people[cosignSent.to].id && report.sent;
    if (!(report.state === "sent" && stored.cosigner === me) && !scenario) return [];
    const project = clinicalProjectRef();
    return [
      {
        id: report.id,
        case_id: caseId,
        case_label: item.label,
        project,
        from_user_id: report.sent_by_user_id ?? "",
        template: report.template,
        sent_at: report.sent_at ?? "",
      },
    ];
  });
};

export const cosignRequestHandlers = (): RequestHandler[] => [
  http.get("*/api/me/cosign-requests", () => HttpResponse.json(asksOf())),
];
