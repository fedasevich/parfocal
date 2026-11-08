import type { DeviceStorage } from "../shell/device-settings.ts";
import { readDeviceSettings, writeDeviceSetting } from "../shell/device-settings.ts";
import { analyticsOptedOut } from "./consent.ts";
import type { EventProperties, EventSink } from "./events.ts";
import { seqPoints, susScoreTenths } from "./survey-items.ts";
import type { TaskKind } from "./task-timer.ts";

const stateKey = "survey_state";
const hour = 3_600_000;
const day = 24 * hour;

export const surveyRules = {
  sessionsBeforeSus: 5,
  susRepeatMs: 90 * day,
  susDismissedMs: 14 * day,
  seqGapMs: 2 * hour,
  seqPerKindMs: 7 * day,
  seqDismissedMs: 7 * day,
  seqOfferLifeMs: 15 * 60_000,
} as const;

export type SurveyState = {
  sessions: number;
  susSessionsAtPrompt: number;
  susNotBefore: number;
  seqNotBefore: number;
  seqKindNotBefore: Record<string, number>;
};

export const freshSurveyState: SurveyState = {
  sessions: 0,
  susSessionsAtPrompt: 0,
  susNotBefore: 0,
  seqNotBefore: 0,
  seqKindNotBefore: {},
};

export type SeqOffer = { survey: "seq"; taskKind: TaskKind; caseId: string; offeredAt: number };
export type SurveyOffer = SeqOffer | { survey: "sus" };

const counted = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

export function readSurveyState(storage?: DeviceStorage): SurveyState {
  const stored: unknown = readDeviceSettings(storage)[stateKey];
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return freshSurveyState;
  }
  const raw = stored as Record<string, unknown>;
  const perKind: Record<string, number> = {};
  const kinds = raw.seqKindNotBefore;
  if (typeof kinds === "object" && kinds !== null) {
    for (const [kind, at] of Object.entries(kinds)) perKind[kind] = counted(at);
  }
  return {
    sessions: counted(raw.sessions),
    susSessionsAtPrompt: counted(raw.susSessionsAtPrompt),
    susNotBefore: counted(raw.susNotBefore),
    seqNotBefore: counted(raw.seqNotBefore),
    seqKindNotBefore: perKind,
  };
}

export type SurveyPrompter = {
  sessionStarted(): void;
  taskFinished(kind: TaskKind, caseId: string): void;
  current(): SurveyOffer | null;
  answerSeq(score: number): boolean;
  answerSus(answers: readonly number[]): boolean;
  dismiss(): void;
  subscribe(listener: () => void): () => void;
};

export type SurveyDeps = {
  sink: EventSink;
  now: () => number;
  held: () => boolean;
  optedOut?: () => boolean;
  storage?: DeviceStorage;
};

export function createSurveyPrompter(deps: SurveyDeps): SurveyPrompter {
  const optedOut = deps.optedOut ?? (() => analyticsOptedOut(deps.storage));
  const listeners = new Set<() => void>();
  let seqOffer: SeqOffer | null = null;
  let susOffered = false;

  const state = () => readSurveyState(deps.storage);
  const save = (next: SurveyState) => {
    writeDeviceSetting(stateKey, next, deps.storage);
  };
  const changed = () => {
    for (const listener of listeners) listener();
  };

  const susDue = (current: SurveyState) =>
    current.sessions - current.susSessionsAtPrompt >= surveyRules.sessionsBeforeSus &&
    deps.now() >= current.susNotBefore;

  const closeSeq = (waitMs: number) => {
    if (seqOffer === null) return;
    const current = state();
    save({
      ...current,
      seqNotBefore: deps.now() + surveyRules.seqGapMs,
      seqKindNotBefore: { ...current.seqKindNotBefore, [seqOffer.taskKind]: deps.now() + waitMs },
    });
    seqOffer = null;
  };

  const closeSus = (waitMs: number) => {
    const current = state();
    save({ ...current, susSessionsAtPrompt: current.sessions, susNotBefore: deps.now() + waitMs });
    susOffered = false;
  };

  const currentOffer = (): SurveyOffer | null => {
    if (optedOut() || deps.held()) return null;
    if (seqOffer !== null) {
      if (deps.now() - seqOffer.offeredAt <= surveyRules.seqOfferLifeMs) return seqOffer;
      seqOffer = null;
    }
    if (susOffered || susDue(state())) {
      susOffered = true;
      return { survey: "sus" };
    }
    return null;
  };

  return {
    sessionStarted() {
      const current = state();
      save({ ...current, sessions: current.sessions + 1 });
      changed();
    },
    taskFinished(kind, caseId) {
      if (optedOut() || seqOffer !== null) return;
      const current = state();
      const at = deps.now();
      if (at < current.seqNotBefore) return;
      if (at < (current.seqKindNotBefore[kind] ?? 0)) return;
      seqOffer = { survey: "seq", taskKind: kind, caseId, offeredAt: at };
      changed();
    },
    current: currentOffer,
    answerSeq(score) {
      const offer = currentOffer();
      if (offer?.survey !== "seq" || !Number.isInteger(score)) return false;
      if (score < 1 || score > seqPoints) return false;
      deps.sink.track("seq_answered", {
        task_kind: offer.taskKind,
        case_id: offer.caseId,
        ease_score: score,
      });
      closeSeq(surveyRules.seqPerKindMs);
      changed();
      return true;
    },
    answerSus(answers) {
      const offer = currentOffer();
      const score = susScoreTenths(answers);
      if (offer?.survey !== "sus" || score === null) return false;
      const [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10] = answers as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const properties: EventProperties<"sus_answered"> = {
        item_one: a1,
        item_two: a2,
        item_three: a3,
        item_four: a4,
        item_five: a5,
        item_six: a6,
        item_seven: a7,
        item_eight: a8,
        item_nine: a9,
        item_ten: a10,
        sus_score_tenths: score,
      };
      deps.sink.track("sus_answered", properties);
      closeSus(surveyRules.susRepeatMs);
      changed();
      return true;
    },
    dismiss() {
      const offer = currentOffer();
      if (offer === null) return;
      deps.sink.track("survey_dismissed", { survey: offer.survey });
      if (offer.survey === "seq") closeSeq(surveyRules.seqDismissedMs);
      else closeSus(surveyRules.susDismissedMs);
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
