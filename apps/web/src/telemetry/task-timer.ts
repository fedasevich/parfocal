import type { areas, EventSink, taskKinds } from "./events.ts";

export type TaskKind = (typeof taskKinds)[number];
export type Area = (typeof areas)[number];

export type TaskTimer = {
  start(kind: TaskKind, caseId: string): void;
  finish(kind: TaskKind, caseId: string, estimatedMs?: number): void;
  abandon(kind: TaskKind, caseId: string): void;
  areaEntered(): void;
  areaLeft(area: Area): void;
  cellShown(): void;
  cellDecided(slideId: string): void;
  chromeMeasured(area: Area, coveredShare: number): void;
};

const keyOf = (kind: string, caseId: string) => `${kind}:${caseId}`;

export function createTaskTimer(sink: EventSink, clock: () => number): TaskTimer {
  const running = new Map<string, number>();
  let areaSince: number | null = null;
  let cellSince: number | null = null;

  const elapsedOf = (since: number) => Math.max(0, Math.round(clock() - since));

  return {
    start(kind, caseId) {
      running.set(keyOf(kind, caseId), clock());
      sink.track("task_started", { task_kind: kind, case_id: caseId });
    },
    finish(kind, caseId, estimatedMs) {
      const key = keyOf(kind, caseId);
      const since = running.get(key);
      if (since === undefined) return;
      running.delete(key);
      const duration = elapsedOf(since);
      sink.track("task_finished", { task_kind: kind, case_id: caseId, duration_ms: duration });
      if (estimatedMs !== undefined && estimatedMs > 0) {
        sink.track("reading_time_compared", {
          task_kind: kind,
          case_id: caseId,
          estimated_ms: Math.round(estimatedMs),
          duration_ms: duration,
        });
      }
    },
    abandon(kind, caseId) {
      const key = keyOf(kind, caseId);
      const since = running.get(key);
      if (since === undefined) return;
      running.delete(key);
      sink.track("task_abandoned", {
        task_kind: kind,
        case_id: caseId,
        duration_ms: elapsedOf(since),
      });
    },
    areaEntered() {
      areaSince = clock();
    },
    areaLeft(area) {
      if (areaSince === null) return;
      sink.track("area_time_recorded", { area, duration_ms: elapsedOf(areaSince) });
      areaSince = null;
    },
    cellShown() {
      cellSince = clock();
    },
    cellDecided(slideId) {
      if (cellSince === null) return;
      sink.track("cell_review_timed", { slide_id: slideId, duration_ms: elapsedOf(cellSince) });
      cellSince = null;
    },
    chromeMeasured(area, coveredShare) {
      const clamped = Math.min(1, Math.max(0, coveredShare));
      sink.track("chrome_coverage_measured", {
        area,
        coverage_permille: Math.round(clamped * 1000),
      });
    },
  };
}
