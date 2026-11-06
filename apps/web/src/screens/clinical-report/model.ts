import type { ClinicalReport, ClinicalValues } from "@parfocal/api-client";
import type { ReportDocumentModel } from "@parfocal/ui/lib/report-document";
import type { mockScenes } from "../scenes.ts";

export type ReportScene = (typeof mockScenes.creport)[number];
export type CosignScene = (typeof mockScenes.cosign)[number];
export type StepKey = "findings" | "staging" | "text" | "sign";
export type ReportModal = "deposit" | "sign" | "amend";
export type Category = "macro" | "micro" | "itc";
export type Extranodal = "present" | "absent" | "na";

export const stepKeys: StepKey[] = ["findings", "staging", "text", "sign"];

export const nodeStandards: [string, string][] = [
  ["ICCR", "Surgically removed lymph nodes for breast tumours, 1st ed. v1.2"],
  ["CAP", "Synoptic format and element names, Breast Invasive Resection 4.11"],
  ["TNM", "UICC and AJCC 8th edition, pN with (sn) and (i+)"],
];

export type Dep = {
  id: string;
  slide: string;
  objectId: string | null;
  size: string;
  note: string;
  unmeasured?: boolean;
  serverId?: string;
};

export type Values = {
  specimen: string;
  deposits: Dep[];
  category: Category | null;
  ack: boolean;
  examined: string;
  extranodal: Extranodal | null;
  diagnosis: string;
  diagnosisAuto: string | null;
  microscopic: string;
  comment: string;
};

export type Signature = { by: string; co: string | null; at: string };

export type Report = {
  values: Values;
  mode: "sign" | "cosign";
  cosigner: string | null;
  removed: { index: number; deposit: Dep } | null;
  seen: StepKey[];
  touched: Record<string, boolean>;
  sent: { to: string; at: string; id: string } | null;
  signed: Signature | null;
  v1: Values | null;
  amend: { why: string; at: string } | null;
  showV1: boolean;
  preview: boolean;
};

export type ReportData = ClinicalReport;

export const categoryNames: Record<Category, string> = {
  macro: "Macrometastasis",
  micro: "Micrometastasis",
  itc: "Isolated tumor cells",
};

export const categoryOptions: { value: Category; title: string; sub: string }[] = [
  { value: "macro", title: "Macrometastasis", sub: "Over 2 mm" },
  { value: "micro", title: "Micrometastasis", sub: "0.2 to 2 mm" },
  { value: "itc", title: "Isolated tumor cells", sub: "Up to 0.2 mm and 200 cells" },
];

export const extranodalNames: Record<Extranodal, string> = {
  present: "Present",
  absent: "Absent",
  na: "Not assessed",
};

const pnOf: Record<Category, string> = {
  macro: "pN1a(sn)",
  micro: "pN1mi(sn)",
  itc: "pN0(i+)(sn)",
};

export const fieldNames = { diag: "Final diagnosis", micro: "Microscopic", comment: "Comment" };

export const fmtMm = (value: number) => value.toFixed(value < 1 ? 2 : 1);

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export const andJoin = (items: string[]) =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export function parseNumber(value: string | null | undefined, integer = false): number | null {
  const text = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return integer && !Number.isInteger(number) ? null : number;
}

export function depositMm(deposit: Pick<Dep, "size"> | undefined): number | null {
  const number = parseNumber(deposit?.size);
  return number !== null && number > 0 && number <= 100 ? number : null;
}

export function largestIndex(deposits: Dep[]): number {
  let best = -1;
  let size: number | null = null;
  deposits.forEach((deposit, index) => {
    const mm = depositMm(deposit);
    if (mm !== null && (size === null || mm > size)) {
      size = mm;
      best = index;
    }
  });
  return best;
}

export const largestMm = (deposits: Dep[]) => depositMm(deposits[largestIndex(deposits)]);

export const categoryOf = (mm: number): Category => (mm > 2 ? "macro" : mm > 0.2 ? "micro" : "itc");

export const slideOf = (data: ReportData, key: string) =>
  data.slides.find((slide) => slide.key === key) ?? {
    key,
    id: key,
    label: key,
    node: 1,
    short: key,
  };

export const positiveNodes = (data: ReportData, deposits: Dep[]) =>
  new Set(deposits.map((deposit) => slideOf(data, deposit.slide).node)).size;

export function suggestedPn(data: ReportData, values: Values): string | null {
  if (!values.category) return null;
  if (values.category !== "macro") return pnOf[values.category];
  const positive = positiveNodes(data, values.deposits) || 1;
  return positive > 9 ? "pN3a" : positive > 3 ? "pN2a" : "pN1a(sn)";
}

export const hasStep = (data: ReportData, key: StepKey) =>
  data.template.steps.some((step) => step.key === key);

export const stepLabel = (data: ReportData, key: StepKey) =>
  data.template.steps.find((step) => step.key === key)?.label ?? key;

export function diagnosisOf(data: ReportData, values: Values): string {
  if (!hasStep(data, "staging")) {
    return `${data.case.site}: REACTIVE FOLLICULAR HYPERPLASIA. No evidence of malignancy.`;
  }
  const size = largestMm(values.deposits);
  const count = values.deposits.length;
  const examined = parseNumber(values.examined, true) ?? data.case.examined;
  const detail =
    size === null
      ? ""
      : `, ${categoryNames[categoryOf(size)].toLowerCase()}, ${count > 1 ? `${count} deposits, largest ` : ""}${fmtMm(size)} mm`;
  return `${data.case.site}: METASTATIC CARCINOMA${detail} (${positiveNodes(data, values.deposits)}/${examined}).`;
}

export function withDiagnosis(data: ReportData, values: Values): Values {
  const auto = diagnosisOf(data, values);
  return { ...values, diagnosis: auto, diagnosisAuto: auto };
}

export function followDiagnosis(data: ReportData, values: Values): Values {
  return values.diagnosisAuto !== null && values.diagnosis === values.diagnosisAuto
    ? withDiagnosis(data, values)
    : values;
}

export const depositSource = (data: ReportData, deposit: Dep) =>
  `${deposit.objectId ? `${deposit.objectId} on` : "by hand on"} ${slideOf(data, deposit.slide).short}`;

export const depositShort = (data: ReportData, deposit: Dep) => {
  const mm = depositMm(deposit);
  return `${mm === null ? "no size" : `${fmtMm(mm)} mm`}, ${depositSource(data, deposit)}`;
};

export const depositLine = (data: ReportData, deposit: Dep) => {
  const slide = slideOf(data, deposit.slide);
  const mm = depositMm(deposit);
  const note = deposit.note.trim();
  return `${mm === null ? "Not measured" : `${fmtMm(mm)} mm`}, node ${slide.node}, slide ${slide.label}, ${deposit.objectId ? `object ${deposit.objectId}` : "measured by hand"}${note ? `. ${note}` : ""}`;
};

export const nextDepositId = (report: Report) =>
  `D${
    Math.max(
      0,
      ...report.values.deposits.map((deposit) => Number(deposit.id.slice(1))),
      report.removed ? Number(report.removed.deposit.id.slice(1)) : 0,
    ) + 1
  }`;

export type Issue = { step: StepKey; field: string; text: string; blockText: string };

export function issuesOf(data: ReportData, report: Report, withSign = false): Issue[] {
  const out: Issue[] = [];
  const add = (step: StepKey, field: string, text: string, blockText = text) =>
    out.push({ step, field, text, blockText });
  const values = report.values;
  const specimen = values.specimen.trim();
  if (!specimen)
    add("findings", "specimen", "Name the specimen. It heads the report.", "Specimen is empty");
  else if (specimen.length < 3)
    add("findings", "specimen", "Use at least 3 characters.", "Specimen is too short");
  if (hasStep(data, "staging")) {
    const size = largestMm(values.deposits);
    if (!values.deposits.length) {
      add(
        "staging",
        "deps",
        "Add at least one deposit, from an object on a slide or measured by hand.",
        "No deposit is listed",
      );
    }
    values.deposits.forEach((deposit) => {
      const raw = deposit.size.trim();
      const field = `deps.${deposit.id}`;
      if (!raw) {
        add(
          "staging",
          field,
          deposit.unmeasured ? "Not measured yet." : "Enter the size.",
          deposit.unmeasured ? `${deposit.id} is not measured yet` : `${deposit.id} has no size`,
        );
      } else if (depositMm(deposit) === null) {
        add("staging", field, "Use 0.1 to 100 mm.", `${deposit.id} is not a size in mm`);
      }
    });
    if (!values.category) {
      add(
        "staging",
        "cat",
        "Confirm the category. Pick the suggested one or another.",
        "The category is not confirmed",
      );
    } else if (size !== null && values.category !== categoryOf(size) && !values.ack) {
      add(
        "staging",
        "ack",
        "Tick the box to keep this category, or pick the suggested one.",
        "The category does not match the size",
      );
    }
    const positive = positiveNodes(data, values.deposits);
    const examined = parseNumber(values.examined, true);
    if (examined === null || examined < 1) {
      add("staging", "exam", "Enter the nodes examined, at least 1.", "Nodes examined is empty");
    } else if (positive > examined) {
      add(
        "staging",
        "exam",
        `The deposits are in ${positive} nodes. Nodes examined cannot be fewer.`,
        "Fewer nodes examined than nodes with a deposit",
      );
    }
    if (!values.extranodal) {
      add(
        "staging",
        "ene",
        "Pick one. Not assessed is an answer too.",
        "Extranodal extension is not picked",
      );
    }
  }
  const diagnosis = values.diagnosis.trim();
  if (!diagnosis) add("text", "diag", "Write the final diagnosis.", "Final diagnosis is empty");
  else if (diagnosis.length < 10)
    add("text", "diag", "Use at least 10 characters.", "Final diagnosis is too short");
  if (withSign && modeOf(data, report) === "cosign" && !report.cosigner) {
    const any = signersOf(data).length > 0;
    add(
      "sign",
      "cosigner",
      any ? "Pick who co-signs." : "Nobody in this project can sign out this case.",
      any ? "Nobody is picked to co-sign" : "Nobody can sign out this case",
    );
  }
  return out;
}

export const meOf = (data: ReportData) =>
  data.members.find((member) => member.user_id === data.author_user_id);

export const canSign = (data: ReportData) => meOf(data)?.covers_case ?? false;

export const signersOf = (data: ReportData) =>
  data.members.filter((member) => member.user_id !== data.author_user_id && member.covers_case);

export const modeOf = (data: ReportData, report: Report) =>
  canSign(data) ? report.mode : "cosign";

export const rightNames = {
  own: "Can sign out own cases",
  any: "Can sign out any case",
  never: "Cannot sign out",
} as const;

export function toValues(data: ReportData, from: ClinicalValues): Values {
  const values: Values = {
    specimen: from.specimen,
    deposits: from.deposits.map((deposit) => ({
      id: deposit.id,
      slide: deposit.slide,
      objectId: deposit.object_id,
      size: deposit.size_mm,
      note: deposit.note,
    })),
    category: from.category,
    ack: false,
    examined: from.examined,
    extranodal: from.extranodal,
    diagnosis: from.diagnosis ?? "",
    diagnosisAuto: null,
    microscopic: from.microscopic,
    comment: from.comment,
  };
  return from.diagnosis === null ? withDiagnosis(data, values) : values;
}

export function toApiValues(values: Values): ClinicalValues {
  return {
    specimen: values.specimen.trim(),
    deposits: values.deposits.map((deposit) => ({
      id: deposit.id,
      slide: deposit.slide,
      object_id: deposit.objectId,
      size_mm: deposit.size.trim(),
      note: deposit.note.trim(),
    })),
    category: values.category,
    examined: values.examined.trim(),
    extranodal: values.extranodal,
    diagnosis: values.diagnosis.trim(),
    microscopic: values.microscopic.trim(),
    comment: values.comment.trim(),
  };
}

const extraDeposit: Dep = {
  id: "D4",
  slide: "A2",
  objectId: null,
  size: "0.9",
  note: "Subcapsular, deeper level",
};

const extraDepositOn = (data: ReportData): Dep => ({
  ...extraDeposit,
  slide: data.slides.find((slide) => slide.short === extraDeposit.slide)?.key ?? extraDeposit.slide,
});

export const signedAt = "15 Oct 11:42";

export function sceneReport(
  data: ReportData,
  scene: ReportScene,
  base: Values = toValues(data, data.values),
): Report {
  const values = base;
  const report: Report = {
    values,
    mode: "sign",
    cosigner: null,
    removed: null,
    seen: ["findings"],
    touched: {},
    sent: null,
    signed: null,
    v1: null,
    amend: null,
    showV1: false,
    preview: false,
  };
  const set = (patch: Partial<Values>) => {
    report.values = { ...report.values, ...patch };
  };
  const staging = () => {
    report.seen = ["findings", "staging"];
  };
  const fill = () => {
    set({ category: categoryOf(largestMm(report.values.deposits) ?? 8), extranodal: "absent" });
    report.seen = data.template.steps.map((step) => step.key);
  };
  const sign = () => {
    fill();
    report.signed = { by: data.author_user_id, co: null, at: signedAt };
    report.v1 = report.values;
  };
  switch (scene) {
    case "findings":
      break;
    case "staging":
    case "depadd":
    case "dephand":
      staging();
      break;
    case "deposits":
      staging();
      set({
        deposits: [...report.values.deposits, extraDepositOn(data)],
        category: "macro",
        extranodal: "absent",
      });
      report.values = withDiagnosis(data, report.values);
      break;
    case "deprm": {
      staging();
      const removed = report.values.deposits[1];
      set({
        category: "macro",
        deposits: report.values.deposits.filter((_, index) => index !== 1),
      });
      if (removed) report.removed = { index: 1, deposit: removed };
      break;
    }
    case "contra":
      staging();
      set({ category: "micro", extranodal: "absent" });
      break;
    case "text":
      set({
        category: categoryOf(largestMm(report.values.deposits) ?? 0),
        extranodal: "absent",
      });
      report.seen = ["findings", "staging", "text"];
      break;
    case "nostaging":
      report.seen = ["findings", "text"];
      break;
    case "sign":
    case "cosign":
    case "ssofail":
      fill();
      break;
    case "missing":
      fill();
      set({ diagnosis: "" });
      break;
    case "sent": {
      fill();
      const lenka = signersOf(data)[0]?.user_id ?? null;
      report.cosigner = lenka;
      if (lenka) report.sent = { to: lenka, at: "15 Oct 11:20", id: "" };
      break;
    }
    case "signed":
    case "amend":
      sign();
      break;
    case "amended":
      sign();
      set({ deposits: [...report.values.deposits, extraDepositOn(data)] });
      report.values = withDiagnosis(data, report.values);
      report.amend = {
        why: "A deposit in node 2 was missed, measured by hand on a deeper level of A2 at 0.9 mm",
        at: "16 Oct",
      };
      break;
    case "unmeasured": {
      const [first, ...rest] = report.values.deposits;
      if (first) set({ deposits: [{ ...first, size: "", unmeasured: true }, ...rest] });
      report.values = withDiagnosis(data, report.values);
      break;
    }
  }
  return report;
}

export const sceneStep: Record<ReportScene, StepKey> = {
  findings: "findings",
  staging: "staging",
  deposits: "staging",
  depadd: "staging",
  deprm: "staging",
  contra: "staging",
  text: "text",
  sign: "sign",
  cosign: "sign",
  sent: "sign",
  signed: "sign",
  amended: "sign",
  nostaging: "text",
  missing: "sign",
  unmeasured: "findings",
  dephand: "staging",
  amend: "sign",
  ssofail: "sign",
};

export const sceneModal: Partial<Record<ReportScene, ReportModal>> = {
  depadd: "deposit",
  dephand: "deposit",
  amend: "amend",
  ssofail: "sign",
};

export const personaScenes: ReportScene[] = ["cosign", "sent"];

export type Fact = {
  icon: "flag" | "ruler" | "target";
  label: string;
  text: string;
  warn?: boolean;
  link?: string;
};

export function factsOf(data: ReportData, values: Values): Fact[] {
  const decisions = data.decisions;
  const yes = decisions.filter((item) => item.counts_as === "agree");
  const no = decisions.filter((item) => item.counts_as === "disagree");
  const unsure = decisions.filter((item) => item.counts_as === "unsure");
  const whys = [...new Set(no.map((item) => item.why).filter(Boolean))].map(
    (why) =>
      `${andJoin(no.filter((item) => item.why === why).map((item) => item.object_id))}, ${why}`,
  );
  const regionLine = `${plural(decisions.length, "tumor region")}, ${yes.length || "none"} confirmed as tumor by you${no.length ? `, ${no.length} marked not tumor${whys.length ? ` (${whys.join(" and ")})` : ""}` : ""}${unsure.length ? `, ${unsure.length} not sure` : ""}`;
  const first = yes[0] ?? decisions[0];
  const deposits = values.deposits;
  const big = deposits[largestIndex(deposits)];
  const pending = deposits.find((deposit) => deposit.unmeasured && !deposit.size.trim());
  const positive = positiveNodes(data, deposits);
  const deposit: Fact = !deposits.length
    ? { icon: "ruler", label: "Deposits", text: "None, no region is confirmed as tumor" }
    : pending
      ? {
          icon: "ruler",
          label: "Deposits",
          text: `${pending.id}, ${pending.objectId} on ${slideOf(data, pending.slide).short}, not measured yet`,
          warn: true,
        }
      : {
          icon: "ruler",
          label: "Deposits",
          text: `${plural(deposits.length, "deposit")} in ${plural(positive, "node")}${big ? `, largest ${big.id} at ${fmtMm(depositMm(big) ?? 0)} mm, ${depositSource(data, big)}` : ""}`,
          ...(big?.objectId ? { link: big.objectId } : {}),
        };
  return [
    {
      icon: "flag",
      label: "Tumor regions",
      text: regionLine,
      ...(first ? { link: first.object_id } : {}),
    },
    deposit,
    {
      icon: "target",
      label: "Cells in the sample",
      text: data.case.cells
        ? `${data.case.cells.agree} of ${data.case.cells.of} tumor cells confirmed`
        : "No cell sample in this case",
      ...(data.case.cells && first ? { link: `${first.object_id}·C145` } : {}),
    },
  ];
}

export type Chip = {
  icon: "flag" | "ruler" | "target";
  label: string;
  source: string;
  text: string;
};

export function chipsOf(data: ReportData, values: Values): Chip[] {
  const decisions = data.decisions;
  const slide = data.slide;
  if (!hasStep(data, "staging")) {
    return [
      {
        icon: "flag",
        label: andJoin(decisions.map((item) => item.object_id)),
        source: slide,
        text: `${decisions.length} regions flagged by the AI on ${slide}, all marked not tumor by you (reactive follicle).`,
      },
    ];
  }
  const measured = values.deposits.filter((deposit) => depositMm(deposit) !== null);
  const yes = decisions.filter((item) => item.counts_as === "agree").length;
  const positive = positiveNodes(data, values.deposits);
  const examined = parseNumber(values.examined, true) ?? data.case.examined;
  const all: Chip[] =
    measured.length > 1
      ? [
          {
            icon: "ruler",
            label: `All ${measured.length} deposits`,
            source: `${positive} of ${examined} nodes`,
            text: `${measured.length} deposits in ${positive} of ${examined} nodes: ${andJoin(measured.map((deposit) => `${deposit.id} ${fmtMm(depositMm(deposit) ?? 0)} mm (${depositSource(data, deposit)})`))}.`,
          },
        ]
      : [];
  const cells = data.case.cells;
  return [
    ...all,
    ...measured.map((deposit) => ({
      icon: "ruler" as const,
      label: `${deposit.id} · ${fmtMm(depositMm(deposit) ?? 0)} mm`,
      source: depositSource(data, deposit),
      text: `Deposit ${deposit.id} measures ${fmtMm(depositMm(deposit) ?? 0)} mm (${depositSource(data, deposit)}).`,
    })),
    {
      icon: "flag",
      label: `${decisions[0]?.object_id ?? ""} to ${decisions[decisions.length - 1]?.object_id ?? ""}`,
      source: slide,
      text: `${decisions.length} regions flagged by the AI on ${slide}, ${yes} confirmed as tumor.`,
    },
    ...(cells
      ? [
          {
            icon: "target" as const,
            label: `${cells.agree} of ${cells.of} cells`,
            source: slide,
            text: `${cells.agree} of ${cells.of} sampled tumor cells confirmed on ${slide}.`,
          },
        ]
      : []),
  ];
}

export const formatField = (data: ReportData, field: string, values: Values) => {
  if (field === "size") {
    const size = largestMm(values.deposits);
    return size === null ? "" : `${fmtMm(size)} mm`;
  }
  if (field === "pos") return String(positiveNodes(data, values.deposits));
  if (field === "pn") return suggestedPn(data, values) ?? "";
  if (field.startsWith("deps.")) {
    const deposit = values.deposits.find((candidate) => candidate.id === field.slice(5));
    if (!deposit) return "";
    const mm = depositMm(deposit);
    return mm === null ? deposit.size.trim() : `${fmtMm(mm)} mm`;
  }
  if (field === "cat") return values.category ? categoryNames[values.category] : "";
  if (field === "ene") return values.extranodal ? extranodalNames[values.extranodal] : "";
  const text = {
    specimen: values.specimen,
    exam: values.examined,
    diag: values.diagnosis,
    micro: values.microscopic,
    comment: values.comment,
  }[field];
  return String(text ?? "").trim();
};

const diffFields: [string, string][] = [
  ["specimen", "Specimen"],
  ["size", "Largest deposit"],
  ["cat", "Category"],
  ["pos", "Nodes positive"],
  ["exam", "Nodes examined"],
  ["ene", "Extranodal extension"],
  ["diag", "Final diagnosis"],
  ["micro", "Microscopic"],
  ["comment", "Comment"],
];

export function amendmentChanges(
  data: ReportData,
  before: Values,
  after: Values,
): [string, string | null, string | null][] {
  const textFields = ["diag", "micro", "comment"];
  const diffs = diffFields.filter(
    ([field]) => formatField(data, field, before) !== formatField(data, field, after),
  );
  const ids = [...new Set([...before.deposits, ...after.deposits].map((deposit) => deposit.id))];
  const deposits = ids.flatMap((id): [string, string, string][] => {
    const was = before.deposits.find((deposit) => deposit.id === id);
    const now = after.deposits.find((deposit) => deposit.id === id);
    const from = was ? depositShort(data, was) : "none";
    const to = now ? depositShort(data, now) : "removed";
    return from === to ? [] : [[`Deposit ${id}`, from, to]];
  });
  return [
    ...diffs
      .filter(([field]) => !textFields.includes(field))
      .map(([field, name]): [string, string, string] => [
        name,
        formatField(data, field, before) || "none",
        formatField(data, field, after) || "none",
      ]),
    ...deposits,
    ...diffs
      .filter(([field]) => textFields.includes(field))
      .map(([, name]): [string, null, null] => [name, null, null]),
  ];
}

const longDate = (at: string) => {
  const [day, month, time] = at.split(" ");
  return `${day} ${month === "Oct" ? "October" : month} 2026 at ${time}`;
};

export const lab = {
  name: "Fakultní nemocnice Vltava",
  department: "Department of Pathology",
  address: "Vltavská 1, 150 00 Praha 5",
  footer: "Laboratory 0001 · sample data · not a real patient",
};

export function documentOf(
  data: ReportData,
  report: Report,
  which: "draft" | "current" | "v1",
  nameOf: (userId: string) => string,
): ReportDocumentModel {
  const values = which === "v1" && report.v1 ? report.v1 : report.values;
  const signature = report.signed;
  const amended = which === "current" && report.amend;
  const status = which === "draft" || !signature ? "draft" : amended ? "amended" : "final";
  const reported =
    status === "draft"
      ? "Not yet, draft"
      : amended
        ? `${amended.at} 2026, amended`
        : (signature?.at ?? "").replace(/^(\d+ \w+) /, "$1 2026, ");
  const decisions = data.decisions;
  const yes = decisions.filter((item) => item.counts_as === "agree").length;
  const no = decisions.filter((item) => item.counts_as === "disagree").length;
  const staging = hasStep(data, "staging");
  const size = largestMm(values.deposits);
  const rows: [string, string][] = staging
    ? [
        ["Total number of sentinel lymph nodes examined", values.examined],
        [
          "Number of lymph nodes with metastatic carcinoma",
          String(positiveNodes(data, values.deposits)),
        ],
        ["Number of metastatic deposits", String(values.deposits.length)],
        ...values.deposits.map((deposit): [string, string] => [
          `Deposit ${deposit.id}`,
          depositLine(data, deposit),
        ]),
        ["Size of largest metastatic deposit", size === null ? "Not given" : `${fmtMm(size)} mm`],
        ["Category", values.category ? categoryNames[values.category] : "Not given"],
        [
          "Extranodal extension",
          values.extranodal ? extranodalNames[values.extranodal] : "Not given",
        ],
        [
          "Regional lymph nodes, pN (UICC and AJCC TNM 8)",
          suggestedPn(data, values) ?? "Not given",
        ],
      ]
    : [];
  rows.push([
    "AI-assisted analysis",
    `CAMELYON tumor model v1.0 flagged ${plural(decisions.length, "region")}. The pathologist confirmed ${yes} and rejected ${no}.`,
  ]);
  const signer = signature ? nameOf(signature.by) : "";
  const sign =
    status === "draft" || !signature
      ? null
      : {
          by: signature.co
            ? `Reported by ${nameOf(signature.co)}, verified and signed by MUDr. ${signer}`
            : `Electronically signed by MUDr. ${signer}`,
          at: amended ? "16 October 2026, signed again" : longDate(signature.at),
        };
  const after = [
    ...(values.microscopic.trim()
      ? [{ title: "Microscopic description", body: values.microscopic.trim() }]
      : []),
    ...(values.comment.trim() ? [{ title: "Comment", body: values.comment.trim() }] : []),
  ];
  return {
    status,
    lab,
    head: [
      ["Accession", data.case.label],
      ["Received", data.case.received],
      ["Requested by", data.case.requested_by],
      ["Reported", reported],
    ],
    amendment:
      amended && report.v1
        ? {
            title: `Amendment, ${amended.at} 2026, by MUDr. ${signer}`,
            reason: amended.why,
            changes: amendmentChanges(data, report.v1, report.values),
            note: "Version 1 of 15 Oct 2026, 11:42 stays readable in Parfocal.",
          }
        : undefined,
    sections: [
      { title: "Specimen", body: values.specimen },
      { title: "Clinical history", body: data.case.clinical_history },
      { title: "Final diagnosis", body: values.diagnosis, diagnosis: true },
    ],
    synopticTitle: staging
      ? "Synoptic report · Surgically removed lymph nodes for breast tumors"
      : "Report elements",
    standards: data.template.standards,
    rows,
    after,
    sign,
  };
}
