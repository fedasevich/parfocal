import type { Analytics } from "../clients.ts";
import { analyticsOptedOut } from "./consent.ts";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

type Field = { kind: "id" } | { kind: "choice"; values: readonly string[] } | { kind: "count" };

const id: Field = { kind: "id" };
const count: Field = { kind: "count" };
const choice = (...values: readonly string[]): Field => ({ kind: "choice", values });

export const areas = ["home", "cases", "search", "lab", "viewer", "reports", "admin", "account"];
export const decisions = ["agree", "disagree", "unsure"];
export const tools = [
  "pan",
  "measure",
  "point",
  "polygon",
  "brush",
  "smart_select",
  "compare",
  "overlay",
];
export const surveys = ["sus", "seq"];
export const taskKinds = ["review", "annotate", "upload", "report"];

export const eventSchema = {
  navigation_area_opened: { area: choice(...areas) },
  navigation_case_opened: { case_id: id, slide_id: id },
  navigation_slide_opened: { case_id: id, slide_id: id },
  review_decision_recorded: {
    case_id: id,
    slide_id: id,
    result_id: id,
    decision: choice(...decisions),
  },
  tool_selected: { tool: choice(...tools), slide_id: id },
  tool_used: { tool: choice(...tools), slide_id: id, count },
  task_started: { task_kind: choice(...taskKinds), case_id: id },
  task_finished: { task_kind: choice(...taskKinds), case_id: id, duration_ms: count },
  task_abandoned: { task_kind: choice(...taskKinds), case_id: id, duration_ms: count },
  area_time_recorded: { area: choice(...areas), duration_ms: count },
  cell_review_timed: { slide_id: id, duration_ms: count },
  chrome_coverage_measured: { area: choice(...areas), coverage_permille: count },
  seq_answered: { task_kind: choice(...taskKinds), case_id: id, ease_score: count },
  sus_answered: {
    item_one: count,
    item_two: count,
    item_three: count,
    item_four: count,
    item_five: count,
    item_six: count,
    item_seven: count,
    item_eight: count,
    item_nine: count,
    item_ten: count,
    sus_score_tenths: count,
  },
  survey_dismissed: { survey: choice(...surveys) },
  reading_time_compared: {
    task_kind: choice(...taskKinds),
    case_id: id,
    estimated_ms: count,
    duration_ms: count,
  },
} as const satisfies Record<string, Record<string, Field>>;

export type EventName = keyof typeof eventSchema;

export type EventProperties<Name extends EventName> = {
  [Key in keyof (typeof eventSchema)[Name]]: (typeof eventSchema)[Name][Key] extends {
    kind: "count";
  }
    ? number
    : string;
};

function fieldProblem(field: Field, value: unknown): string | null {
  if (field.kind === "id") {
    return typeof value === "string" && idPattern.test(value) ? null : "is not an id";
  }
  if (field.kind === "count") {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? null
      : "is not a count";
  }
  return typeof value === "string" && field.values.includes(value)
    ? null
    : "is not a listed choice";
}

export function eventProblems(name: string, properties: Record<string, unknown>): string[] {
  if (!Object.hasOwn(eventSchema, name)) return [`unknown event ${name}`];
  const fields: Record<string, Field> = eventSchema[name as EventName];
  const problems: string[] = [];
  for (const key of Object.keys(properties)) {
    if (!Object.hasOwn(fields, key)) problems.push(`${key} is not a field of ${name}`);
  }
  for (const [key, field] of Object.entries(fields)) {
    if (!Object.hasOwn(properties, key)) {
      problems.push(`${key} is missing`);
      continue;
    }
    const problem = fieldProblem(field, properties[key]);
    if (problem !== null) problems.push(`${key} ${problem}`);
  }
  return problems;
}

export type EventSink = {
  track<Name extends EventName>(name: Name, properties: EventProperties<Name>): void;
};

export function eventSink(
  analytics: Analytics,
  optedOut: () => boolean = analyticsOptedOut,
): EventSink {
  return {
    track(name, properties) {
      if (optedOut()) return;
      if (eventProblems(name, properties).length > 0) return;
      analytics.capture(name, properties);
    },
  };
}
