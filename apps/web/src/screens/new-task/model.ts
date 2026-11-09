import type { DisplayDefaults, Question } from "@parfocal/api-client";
import { defaultSampleSize, sampleSizeLimit, validSampleSize } from "@parfocal/ui/lib/sample-size";

export const stepKeys = ["kind", "slides", "reviewers", "check", "how", "send"] as const;
export type StepKey = (typeof stepKeys)[number];
export type PageKey = StepKey | "sent";

export const stepNames: Record<StepKey, string> = {
  kind: "Kind",
  slides: "Slides",
  reviewers: "Reviewers",
  check: "What to check",
  how: "How it runs",
  send: "Send",
};

export const taskScenes = [
  "slides",
  "reviewers",
  "find",
  "check",
  "decision",
  "how",
  "locks",
  "send",
  "sent",
  "noresult",
  "pastdue",
  "away",
  "retiredtpl",
  "nobody",
] as const;
export type TaskScene = (typeof taskScenes)[number];

export const sceneStep: Record<TaskScene, PageKey> = {
  slides: "slides",
  reviewers: "reviewers",
  find: "reviewers",
  check: "check",
  decision: "check",
  how: "how",
  locks: "how",
  send: "send",
  sent: "sent",
  noresult: "slides",
  pastdue: "how",
  away: "reviewers",
  retiredtpl: "slides",
  nobody: "reviewers",
};

export type TaskKindKey = "review" | "annotate";
export type AnnotatePresetKey = "hand" | "run" | "sample" | "regions" | "mixed";
export type AnnotateCheck = {
  scope: "none" | "all" | "sample" | "regions";
  order: "least-sure" | "position";
  rule: "require" | "warn";
  exportUnchecked: boolean;
  hasResult: boolean;
  sampleSize: number;
};

export const defaultAnnotatePreset: AnnotatePresetKey = "run";
export const defaultAnnotateCheck: AnnotateCheck = {
  scope: "all",
  order: "least-sure",
  rule: "require",
  exportUnchecked: false,
  hasResult: true,
  sampleSize: defaultSampleSize,
};

export type ScopeKind = "regions" | "cells" | "low" | "roi" | "unsure";
export type DecisionKindKey = "certainty5" | "agree" | "yesno" | "blind";
export type SplitKey = "all" | "even" | "per";
export type ReminderKey = "2d-daily" | "1d" | "none";
export type LockKey = "conf" | "heat" | "cutoff" | "sets" | "order";
export type Display = DisplayDefaults;

export const lockKeys: readonly LockKey[] = ["conf", "heat", "cutoff", "sets", "order"];

export const scopeRows: { key: ScopeKind; name: string; detail: string }[] = [
  { key: "regions", name: "Tumor regions", detail: "Every region the model drew" },
  { key: "cells", name: "A random sample of cells", detail: "The same sample for every reviewer" },
  {
    key: "low",
    name: "Cells the model was least sure about",
    detail: "Every cell scored under this cutoff",
  },
  { key: "unsure", name: "Unsure zones", detail: "Clusters the model flagged as unsure" },
];

export const roiRow = {
  key: "roi" as const,
  name: "Regions of interest",
  detail: "Objects outside the picked ROIs are left out",
};

export const decisionKinds: { key: DecisionKindKey; name: string; detail: string }[] = [
  {
    key: "certainty5",
    name: "5-point certainty",
    detail: "The AI's claim, then how sure the reviewer is, from 1 Certainly not to 5 Certainly.",
  },
  {
    key: "agree",
    name: "Agree with the AI",
    detail: "The AI's claim, then Agree, Disagree or Not sure.",
  },
  {
    key: "yesno",
    name: "Yes or no",
    detail: "One question for every object, such as Is this tumor? The AI's claim stays hidden.",
  },
  {
    key: "blind",
    name: "Pick the class blind",
    detail: "The reviewer picks the class without seeing the AI's, then Parfocal compares.",
  },
];

export const reminderChoices: { key: ReminderKey; name: string; days: number[] }[] = [
  { key: "2d-daily", name: "2 days before, then daily", days: [2, 1] },
  { key: "1d", name: "The day before", days: [1] },
  { key: "none", name: "None", days: [] },
];

export const questionKinds: Record<string, string> = {
  scale: "1 to 5",
  choice: "choice",
  yesno: "yes or no",
  text: "text",
};

export type SlideChoice = {
  id: string;
  name: string;
  caseLabel: string | null;
  sets: string[];
};

export type SlideGroup = { key: string; title: string; sub: string; slideIds: string[] };

export type ResultSetChoice = {
  id: string;
  key: "cam" | "sam" | "rev";
  label: string;
  short: string;
  detail: string;
};

export type Preset = {
  scope: ScopeKind[];
  scopeOptions: { cells: number; low: number; roi: string[]; unsure: string[] };
  decision: { kind: DecisionKindKey; agreeFrom: number; disagreeTo: number };
  display: Display;
  form: string;
  blind: boolean;
  hide: boolean;
  start: "guided" | "full";
  split: "all" | "even";
};

export type TemplateChoice = {
  id: string;
  name: string;
  version: string;
  kind: string;
  retired: boolean;
  preset: Preset;
  formQuestions?: Question[] | null;
};

export type PersonChoice = {
  id: string;
  name: string;
  initials: string;
  colour: string;
  title: string;
  openTasks: number;
  awayUntil: string | null;
};

export type FormChoice = {
  key: string;
  name: string;
  questions: { label: string; kind: string; required: boolean }[];
};

export type TaskData = {
  code: string;
  taskId: string;
  projectId: string;
  projectName: string;
  today: string;
  slides: SlideChoice[];
  groups: SlideGroup[];
  pool: string[];
  resultSets: ResultSetChoice[];
  names: Record<string, string>;
  templates: TemplateChoice[];
  defaultTemplateId: string;
  people: PersonChoice[];
  rois: { key: string; name: string }[];
  zones: { key: string; cells: number }[];
  forms: FormChoice[];
  defaults: { resultSetId: string; reviewerIds: string[]; due: string; reminders: ReminderKey };
};

export type Draft = {
  kind: TaskKindKey;
  preset: AnnotatePresetKey;
  check: AnnotateCheck;
  templateId: string;
  retired: string[];
  groups: Record<string, boolean>;
  extraSlides: string[];
  resultSetId: string;
  name: string;
  nameSet: boolean;
  reviewers: string[];
  invites: string[];
  split: SplitKey;
  per: Record<string, boolean>;
  scope: Record<ScopeKind, boolean>;
  scopeOptions: { cells: number | string; low: number | string; roi: string[]; unsure: string[] };
  decision: { kind: DecisionKindKey; agreeFrom: number; disagreeTo: number };
  blind: boolean;
  blindFirst: boolean;
  hide: boolean;
  start: "guided" | "full";
  form: string;
  required: string[];
  display: Display;
  locks: Partial<Record<LockKey, string>>;
  dispOpen: boolean;
  due: string;
  reminders: ReminderKey;
  note: string;
  seen: StepKey[];
  touched: Record<string, boolean>;
  sentAt: string | null;
  findQuery: string;
};

export type Issue = {
  step: StepKey;
  field: string;
  text: string;
  block: boolean;
  blockText?: string;
};

const scopeKindList = [
  "regions",
  "cells",
  "low",
  "roi",
  "unsure",
] as const satisfies readonly ScopeKind[];

const noScope: Record<ScopeKind, boolean> = {
  regions: false,
  cells: false,
  low: false,
  roi: false,
  unsure: false,
};

export const requiredOf = (form: FormChoice | undefined) =>
  (form?.questions ?? []).flatMap((question, index) =>
    question.required ? [`q${index + 1}`] : [],
  );

export function applyTemplate(draft: Draft, template: TemplateChoice, data: TaskData): Draft {
  const preset = template.preset;
  return {
    ...draft,
    templateId: template.id,
    scope: { ...noScope, ...Object.fromEntries(preset.scope.map((key) => [key, true])) },
    scopeOptions: {
      ...preset.scopeOptions,
      roi: [...preset.scopeOptions.roi],
      unsure: [...preset.scopeOptions.unsure],
    },
    blind: preset.blind,
    hide: preset.hide,
    start: preset.start,
    split: preset.split,
    form: preset.form,
    required: requiredOf(data.forms.find((form) => form.key === preset.form)),
    decision: { ...preset.decision },
    display: { ...preset.display, sets: { ...preset.display.sets } },
    locks: {},
  };
}

export function preselectedTemplate(
  projectDefault: string,
  workspaceDefault: string | null,
  templates: readonly { id: string; retired: boolean }[],
) {
  const usable = (id: string | null) =>
    id !== null && id !== "" && templates.some((item) => item.id === id && !item.retired);
  if (usable(projectDefault)) return projectDefault;
  if (usable(workspaceDefault)) return workspaceDefault as string;
  return projectDefault;
}

export const templateOf = (draft: Draft, data: TaskData) =>
  data.templates.find((candidate) => candidate.id === draft.templateId);

const sameList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && [...left].sort().join() === [...right].sort().join();

export type TemplateChanges = { check: boolean; how: boolean; form: boolean };

export function templateChanges(draft: Draft, data: TaskData): TemplateChanges {
  const template = templateOf(draft, data);
  if (!template || draft.kind === "annotate") return { check: false, how: false, form: false };
  const preset = template.preset;
  const scopeKeys = scopeKindList.filter((key) => draft.scope[key]);
  const options = draft.scopeOptions;
  const check =
    !sameList(scopeKeys, preset.scope) ||
    String(options.cells) !== String(preset.scopeOptions.cells) ||
    String(options.low) !== String(preset.scopeOptions.low) ||
    !sameList(options.roi, preset.scopeOptions.roi) ||
    !sameList(options.unsure, preset.scopeOptions.unsure);
  const how =
    draft.blind !== preset.blind ||
    draft.hide !== preset.hide ||
    draft.start !== preset.start ||
    draft.split !== preset.split ||
    draft.decision.kind !== preset.decision.kind ||
    draft.decision.agreeFrom !== preset.decision.agreeFrom ||
    draft.decision.disagreeTo !== preset.decision.disagreeTo ||
    JSON.stringify(draft.display) !== JSON.stringify(preset.display);
  const presetRequired = requiredOf(data.forms.find((form) => form.key === preset.form));
  const form = draft.form !== preset.form || !sameList(draft.required, presetRequired);
  return { check, how, form };
}

export function initialDraft(data: TaskData): Draft {
  const template =
    data.templates.find((candidate) => candidate.id === data.defaultTemplateId) ??
    data.templates[0];
  const base: Draft = {
    kind: "review",
    preset: defaultAnnotatePreset,
    check: { ...defaultAnnotateCheck },
    templateId: data.defaultTemplateId,
    retired: [],
    groups: Object.fromEntries(data.groups.map((group) => [group.key, true])),
    extraSlides: [],
    resultSetId: data.defaults.resultSetId,
    name: data.names[data.defaults.resultSetId] ?? "",
    nameSet: false,
    reviewers: [...data.defaults.reviewerIds],
    invites: [],
    split: "all",
    per: {},
    scope: { ...noScope },
    scopeOptions: { cells: 50, low: 0.6, roi: [], unsure: [] },
    decision: { kind: "certainty5", agreeFrom: 4, disagreeTo: 2 },
    blind: true,
    blindFirst: false,
    hide: false,
    start: "guided",
    form: "default",
    required: [],
    display: {} as Display,
    locks: {},
    dispOpen: false,
    due: data.defaults.due,
    reminders: data.defaults.reminders,
    note: "",
    seen: ["kind"],
    touched: {},
    sentAt: null,
    findQuery: "",
  };
  return template ? applyTemplate(base, template, data) : base;
}

const seenUpTo = (page: PageKey): StepKey[] => {
  const last = page === "sent" ? stepKeys.length - 1 : stepKeys.indexOf(page);
  return stepKeys.slice(0, last + 1);
};

export function sceneDraft(data: TaskData, scene: TaskScene): Draft {
  const draft = { ...initialDraft(data), seen: seenUpTo(sceneStep[scene]) };
  const person = (initials: string) =>
    data.people.find((candidate) => candidate.initials === initials)?.id ?? initials;
  switch (scene) {
    case "find":
      return { ...draft, findQuery: "k" };
    case "decision":
      return { ...draft, decision: { ...draft.decision, agreeFrom: 5, disagreeTo: 2 } };
    case "locks":
      return { ...draft, dispOpen: true, locks: { conf: "Confidence hidden this round" } };
    case "sent":
      return { ...draft, sentAt: "15 Oct" };
    case "noresult": {
      const groups = Object.fromEntries(data.groups.map((group) => [group.key, false]));
      const loose = data.groups.find((group) => group.key === "loose");
      if (loose) groups[loose.key] = true;
      return { ...draft, groups, touched: { rset: true } };
    }
    case "pastdue":
      return { ...draft, due: "2026-10-14", touched: { due: true } };
    case "away":
      return { ...draft, reviewers: [person("LM"), person("SM"), person("PK")] };
    case "retiredtpl":
      return { ...draft, retired: [data.defaultTemplateId], touched: { tpl: true } };
    case "nobody":
      return { ...draft, reviewers: [], touched: { revs: true } };
    case "slides":
    case "reviewers":
    case "check":
    case "how":
    case "send":
      return draft;
  }
}

export const isRetired = (draft: Draft, template: TemplateChoice) =>
  template.retired || draft.retired.includes(template.id);

export function pickedSlides(draft: Draft, data: TaskData) {
  const byId = new Map(data.slides.map((slide) => [slide.id, slide]));
  const grouped = data.groups
    .filter((group) => draft.groups[group.key])
    .flatMap((group) =>
      group.slideIds.flatMap((id) => {
        const slide = byId.get(id);
        return slide ? [{ ...slide, group: group.title }] : [];
      }),
    );
  const extra = draft.extraSlides.flatMap((id) => {
    const slide = byId.get(id);
    return slide
      ? [{ ...slide, group: slide.caseLabel ? `Case ${slide.caseLabel}` : "Loose" }]
      : [];
  });
  return [...grouped, ...extra];
}

export const isAnnotate = (draft: Draft) => draft.kind === "annotate";

export const usesResult = (draft: Draft) => !isAnnotate(draft) || draft.check.hasResult;

export const slidesInTask = (draft: Draft, data: TaskData) =>
  isAnnotate(draft)
    ? pickedSlides(draft, data)
    : pickedSlides(draft, data).filter((slide) => slide.sets.includes(draft.resultSetId));

export const slidesWithResult = (draft: Draft, data: TaskData) =>
  pickedSlides(draft, data).filter((slide) => slide.sets.includes(draft.resultSetId));

export const whoReviews = (draft: Draft) => [...draft.reviewers, ...draft.invites];

export function perSlideOn(draft: Draft, key: string) {
  const set = draft.per[key];
  if (set !== undefined) return set;
  const [index, id] = key.split("|");
  const who = whoReviews(draft);
  return Number(index) % Math.max(1, who.length) === who.indexOf(id ?? "");
}

export function slidesWithoutReviewer(draft: Draft, data: TaskData) {
  const who = whoReviews(draft);
  return slidesInTask(draft, data).filter(
    (_, index) => !who.some((id) => perSlideOn(draft, `${index}|${id}`)),
  ).length;
}

const finite = (value: number | string) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const annotateObjectsPerSlide = { all: 46, regions: 12 } as const;
export const annotateDrawMinutes = 6;

function annotateObjects(draft: Draft, data: TaskData) {
  const scope = draft.check.scope;
  if (!draft.check.hasResult || scope === "none") return 0;
  const picked = pickedSlides(draft, data).length;
  if (!picked) return 0;
  const share = slidesWithResult(draft, data).length / picked;
  const perSlide =
    scope === "sample" ? finite(draft.check.sampleSize) : annotateObjectsPerSlide[scope];
  return Math.round(perSlide * share);
}

export function objectsPerSlide(draft: Draft, data: TaskData) {
  if (isAnnotate(draft)) return annotateObjects(draft, data);
  const options = draft.scopeOptions;
  let count =
    (draft.scope.regions ? 5 : 0) +
    (draft.scope.cells ? finite(options.cells) : 0) +
    (draft.scope.low ? Math.round(30 * finite(options.low)) : 0) +
    (draft.scope.unsure
      ? data.zones
          .filter((zone) => options.unsure.includes(zone.key))
          .reduce((sum, zone) => sum + zone.cells, 0)
      : 0);
  if (draft.scope.roi) count = Math.round(count * Math.min(1, 0.15 * options.roi.length + 0.2));
  return count;
}

export function summary(draft: Draft, data: TaskData) {
  const who = whoReviews(draft);
  const n = who.length;
  const slides = slidesInTask(draft, data);
  const ns = slides.length;
  const split: SplitKey = n < 2 && draft.split === "even" ? "all" : draft.split;
  const counts = who.map((id) =>
    split === "all"
      ? ns
      : split === "even"
        ? Math.ceil(ns / n)
        : slides.filter((_, index) => perSlideOn(draft, `${index}|${id}`)).length,
  );
  const per = counts.length ? Math.max(...counts) : ns;
  const objects = objectsPerSlide(draft, data);
  return {
    who,
    n,
    ns,
    all: pickedSlides(draft, data).length,
    split,
    counts,
    per,
    objects,
    hours: (per * (objects * 20 + (isAnnotate(draft) ? annotateDrawMinutes * 60 : 0))) / 3600,
  };
}

export type Summary = ReturnType<typeof summary>;

export const scopeKinds = (draft: Draft) =>
  (["regions", "cells", "low", "unsure"] as const).filter((key) => draft.scope[key]);

export const span = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);

export function mapping(decision: Draft["decision"]) {
  return {
    agree: span(decision.agreeFrom, 5),
    unsure: span(decision.disagreeTo + 1, decision.agreeFrom - 1),
    disagree: span(1, decision.disagreeTo),
  };
}

export const mappingOk = (decision: Draft["decision"]) => {
  const map = mapping(decision);
  return (
    map.agree.length > 0 &&
    map.disagree.length > 0 &&
    !map.agree.some((value) => map.disagree.includes(value))
  );
};

export function numberList(values: number[]) {
  return values.length === 1
    ? `${values[0]}`
    : values.length === 2
      ? `${values[0]} and ${values[1]}`
      : `${values[0]} to ${values[values.length - 1]}`;
}

export const andJoin = (items: string[]) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function hoursText(hours: number) {
  if (hours < 0.75) return `${Math.max(10, Math.round((hours * 60) / 10) * 10)} minutes`;
  const rounded = Math.round(hours * 2) / 2;
  return `${rounded} hour${rounded === 1 ? "" : "s"}`;
}

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dueText(due: string) {
  if (!due) return "";
  const [year, month, day] = due.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1));
  return `${days[date.getUTCDay()]} ${day} ${months[(month ?? 1) - 1]}`;
}

export const shortDate = (iso: string) => {
  const [, month, day] = iso.slice(0, 10).split("-").map(Number);
  return `${day} ${months[(month ?? 1) - 1]}`;
};

const scopeKindsList = ["regions", "cells", "low", "unsure"] as const;

export function scopePhrase(draft: Draft) {
  const options = draft.scopeOptions;
  const low = Number(options.low);
  const parts: Record<(typeof scopeKindsList)[number], string> = {
    regions: "tumor regions",
    cells: `${options.cells} random cells per slide`,
    low: `cells scored under ${Number.isFinite(low) ? low.toFixed(2) : options.low}`,
    unsure: `unsure zones ${andJoin(options.unsure)}`,
  };
  const text = andJoin(scopeKinds(draft).map((key) => parts[key]));
  if (!text) return "";
  const inside =
    draft.scope.roi && options.roi.length ? `, only inside ${andJoin(options.roi)}` : "";
  return `${text[0]?.toUpperCase()}${text.slice(1)}${inside}`;
}

export function estimateText(draft: Draft, data: TaskData) {
  if (isAnnotate(draft)) {
    const sum = summary(draft, data);
    if (!sum.ns || !sum.n) return "";
    const checks = sum.objects ? `About ${sum.objects} AI objects per slide to check and ` : "";
    return `${checks}${checks ? "roughly" : "Roughly"} ${hoursText(sum.hours)} for each expert, with ${annotateDrawMinutes} minutes of drawing per slide.`;
  }
  if (!scopeKinds(draft).length) return "";
  const sum = summary(draft, data);
  const samples = (["cells", "low", "unsure"] as const).filter((key) => draft.scope[key]).length;
  return `About ${sum.objects} objects per slide and ${hoursText(sum.hours)} for each reviewer.${samples > 1 ? " The samples add up, and a cell picked twice counts once." : ""} Every object keeps its ID, so each decision traces back to one region or cell.`;
}

export function mappingText(decision: Draft["decision"]) {
  const map = mapping(decision);
  const middle = map.unsure.length ? `${numberList(map.unsure)} as not sure, and ` : "and ";
  return `${numberList(map.agree)} count${map.agree.length === 1 ? "s" : ""} as agree with the AI, ${middle}${numberList(map.disagree)} as disagree.${map.unsure.length ? "" : " No answer counts as not sure."}`;
}

export const displayWords = {
  draw: { outline: "Outline", fill: "Fill", dots: "Dots" },
  conf: {
    number: "confidence as a number",
    word: "confidence as a word",
    color: "confidence as a color",
    hidden: "confidence hidden",
  },
  order: {
    ai: "AI order",
    size: "Largest first",
    leastsure: "Least sure first",
    random: "Random order",
  },
} as const;

export function displaySummary(draft: Draft) {
  const locked = Object.keys(draft.locks).length;
  const display = draft.display;
  return `${displayWords.draw[display.draw]} · ${displayWords.conf[display.conf]} · ${displayWords.order[display.order]}${locked ? ` · ${locked} locked` : ""}`;
}

export function annotateSlideLine(sum: Summary, withResult: number, rsShort: string) {
  if (!sum.all) return "No slides picked yet.";
  const none = sum.all - withResult;
  return `${sum.all} picked. ${withResult} have ${rsShort}, ${none} ${none === 1 ? "has" : "have"} no result set and are annotated by hand.`;
}

export function slideLine(sum: Summary, rsShort: string) {
  const out = sum.all - sum.ns;
  if (!sum.all) return "No slides picked yet.";
  if (!sum.ns) return `${sum.all} picked, none has ${rsShort}.`;
  if (out)
    return `${sum.all} picked. ${sum.ns} have ${rsShort}, ${out} ${out > 1 ? "are" : "is"} left out.`;
  return `${sum.all} picked, all with ${rsShort}.`;
}

export function splitText(sum: Summary, nameOf: (id: string) => string) {
  if (!sum.n || !sum.ns) return "";
  if (sum.split === "all") return `Everyone reviews all ${sum.ns}`;
  if (sum.split === "even") return `Split evenly, about ${sum.per} each`;
  return `Per slide, ${sum.who.map((id, index) => `${nameOf(id)} ${sum.counts[index]}`).join(", ")}`;
}

export function sendLabel(draft: Draft) {
  const n = draft.reviewers.length;
  const invited = draft.invites.length;
  const reviewers = plural(n, "reviewer");
  if (!invited && !n) return "Create and notify";
  if (!invited) return `Create and notify ${reviewers}`;
  if (!n) return `Create and invite ${invited}`;
  return `Create, notify ${reviewers} and invite ${invited}`;
}

const validCells = (value: number | string) =>
  typeof value === "number" && value >= 10 && value <= 500 && value % 10 === 0;

const validLow = (value: number | string) =>
  typeof value === "number" &&
  value >= 0.1 - 1e-9 &&
  value <= 0.95 + 1e-9 &&
  Math.abs(value * 20 - Math.round(value * 20)) < 1e-6;

export function issues(draft: Draft, data: TaskData): Issue[] {
  const out: Issue[] = [];
  const add = (step: StepKey, field: string, text: string, more: Partial<Issue> = {}) =>
    out.push({ step, field, text, block: false, ...more });
  const sum = summary(draft, data);
  const rs = data.resultSets.find((set) => set.id === draft.resultSetId);
  const template = data.templates.find((candidate) => candidate.id === draft.templateId);
  const annotate = isAnnotate(draft);
  if (!annotate && template && isRetired(draft, template)) {
    add("slides", "tpl", "The project's default template was retired. Pick another.", {
      block: true,
      blockText: "Pick a template.",
    });
  }
  if (!pickedSlides(draft, data).length) {
    add("slides", "groups", "Pick at least one slide.", { block: true });
  } else if (!annotate && !sum.ns) {
    add("slides", "rset", `None of the picked slides has ${rs?.short ?? "this result set"}.`, {
      block: true,
      blockText: "Pick slides with this result set, or run the model first.",
    });
  }
  const name = draft.name.trim();
  if (!name) add("slides", "name", "Give the task a name. Reviewers see it in My work.");
  else if (name.length < 3) add("slides", "name", "Use at least 3 characters.");
  if (!sum.n) add("reviewers", "revs", "Pick at least one reviewer.", { block: true });
  else if (draft.split === "per") {
    const empty = slidesWithoutReviewer(draft, data);
    if (empty) {
      add("reviewers", "split", `${empty} slide${empty > 1 ? "s have" : " has"} no reviewer.`, {
        block: true,
      });
    }
  }
  const options = draft.scopeOptions;
  if (annotate) {
    if (
      draft.check.hasResult &&
      draft.check.scope === "sample" &&
      !validSampleSize(draft.check.sampleSize)
    ) {
      add("check", "sampleSize", `Use a whole number from 1 to ${sampleSizeLimit}.`, {
        block: true,
      });
    }
    return [...out, ...whenIssues(draft, data)];
  }
  if (!scopeKinds(draft).length) {
    add("check", "scope", "Pick at least one kind of object.", { block: true });
  }
  if (draft.scope.cells && !validCells(options.cells)) {
    add("check", "scopeOpts.cells", "Use a number from 10 to 500, in steps of 10.");
  }
  if (draft.scope.low && !validLow(options.low)) {
    add("check", "scopeOpts.low", "Use a score from 0.10 to 0.95, in steps of 0.05.");
  }
  if (draft.scope.roi && !options.roi.length)
    add("check", "scopeOpts.roi", "Pick at least one ROI.");
  if (draft.scope.unsure && !options.unsure.length) {
    add("check", "scopeOpts.unsure", "Pick at least one unsure zone.");
  }
  if (draft.decision.kind === "certainty5" && !mappingOk(draft.decision)) {
    add("check", "decision", "At least one answer must count as agree and one as disagree.");
  }
  for (const [key, reason] of Object.entries(draft.locks)) {
    const text = (reason ?? "").trim();
    if (!text)
      add("how", `locks.${key}`, "Say why. Reviewers see this reason next to the locked setting.");
    else if (text.length < 5) add("how", `locks.${key}`, "Use at least 5 characters.");
  }
  return [...out, ...whenIssues(draft, data)];
}

function whenIssues(draft: Draft, data: TaskData): Issue[] {
  if (!draft.due) {
    return [
      {
        step: "how",
        field: "due",
        text: "Pick a due date.",
        block: true,
        blockText: "Fix the due date.",
      },
    ];
  }
  if (draft.due <= data.today) {
    return [
      {
        step: "how",
        field: "due",
        text: "The due date is in the past. Pick a later day.",
        block: true,
        blockText: "Fix the due date.",
      },
    ];
  }
  return [];
}

export function fieldErrors(draft: Draft, data: TaskData) {
  const errors = new Map<string, string>();
  for (const issue of issues(draft, data)) {
    if (draft.touched[issue.field] && !errors.has(issue.field)) {
      errors.set(issue.field, issue.text);
    }
  }
  return errors;
}

export function stepState(draft: Draft, all: Issue[], step: StepKey, current: PageKey) {
  if (current === "sent") return "done" as const;
  if (step === current) return "current" as const;
  if (!draft.seen.includes(step)) return "todo" as const;
  return all.some((issue) => issue.step === step) ? ("warn" as const) : ("done" as const);
}

export function blockersFor(all: Issue[], current: StepKey) {
  return current === "send" ? all : all.filter((issue) => issue.step === current && issue.block);
}

export function touchStep(draft: Draft, all: Issue[], step: StepKey): Draft {
  const touched = { ...draft.touched };
  for (const issue of all) if (issue.step === step) touched[issue.field] = true;
  return { ...draft, touched };
}
