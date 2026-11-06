import type { PersonKey, ScenarioReviewTask } from "./scenario.ts";
import {
  adjudicator,
  adjudicatorDecisions,
  declinedNote,
  editedRow,
  leftOpen,
  type QueueValue,
  queueKey,
  queueRows,
  queueTask,
  researcher,
  researcherDecisions,
  sentToAdjudicator,
} from "./scenario-adjudication.ts";

export type QueueStage = "locked" | "open" | "sent" | "declined" | "adjudicated" | "resolved";

export type FakeQueueScene = {
  stage: QueueStage;
  edited: boolean;
  signed: boolean;
  retired: boolean;
};

export const defaultFakeQueueScene: FakeQueueScene = {
  stage: "locked",
  edited: false,
  signed: false,
  retired: false,
};

export type LiveRowState =
  | "open"
  | "decided"
  | "left-open"
  | "with-adjudicator"
  | "declined"
  | "adjudicated"
  | "look-again";

export type LiveRow = {
  state: LiveRowState;
  decision: { raw: QueueValue; note: string | null; by: PersonKey; at: string } | null;
  adjudicator: { by: PersonKey; note: string | null } | null;
  adjudicated: { raw: string; at: string; note?: string | null } | null;
  edited: boolean;
};

export type NextVersion = { reason: string; at: string } | null;

type QueueState = {
  rows: Map<string, LiveRow>;
  signed: boolean;
  nextVersion: NextVersion;
};

const openRow = (): LiveRow => ({
  state: "open",
  decision: null,
  adjudicator: null,
  adjudicated: null,
  edited: false,
});

function freshState(scene: FakeQueueScene): QueueState {
  const rows = new Map<string, LiveRow>();
  for (const seed of queueRows) {
    const key = queueKey(seed);
    const row = openRow();
    const sent = sentToAdjudicator.includes(key);
    if (sent && scene.stage === "sent") {
      Object.assign(row, {
        state: "with-adjudicator",
        adjudicator: { by: adjudicator, note: null },
      });
    }
    if (sent && scene.stage === "declined") {
      Object.assign(row, {
        state: "declined",
        adjudicator: { by: adjudicator, note: declinedNote },
      });
    }
    if (sent && (scene.stage === "adjudicated" || scene.stage === "resolved")) {
      Object.assign(row, {
        state: "adjudicated",
        adjudicator: { by: adjudicator, note: null },
        adjudicated: adjudicatorDecisions[key] ?? null,
      });
    }
    const mine = researcherDecisions[key];
    if (scene.stage === "resolved" && mine) {
      Object.assign(row, { state: "decided", decision: { ...mine, by: researcher } });
    }
    if (scene.stage === "resolved" && leftOpen.includes(key)) row.state = "left-open";
    if (scene.edited && key === editedRow.key) row.edited = true;
    rows.set(key, row);
  }
  return { rows, signed: scene.signed, nextVersion: null };
}

let scene: FakeQueueScene = defaultFakeQueueScene;
let state: QueueState = freshState(scene);

export function fakeQueueScene(): FakeQueueScene {
  return scene;
}

export function queueState(): QueueState {
  return state;
}

export function resetQueueState(): void {
  state = freshState(scene);
}

export function setFakeQueueScene(next: FakeQueueScene): boolean {
  if (
    next.stage === scene.stage &&
    next.edited === scene.edited &&
    next.signed === scene.signed &&
    next.retired === scene.retired
  ) {
    return false;
  }
  scene = next;
  resetQueueState();
  return true;
}

export function liveRow(key: string): LiveRow {
  const existing = state.rows.get(key);
  if (existing) return existing;
  const row = openRow();
  state.rows.set(key, row);
  return row;
}

export function signQueueTask(): void {
  state.signed = true;
}

export function startNextVersion(reason: string, at: string): void {
  state.nextVersion = { reason, at };
}

export const reviewsAreIn = () => scene.stage !== "locked";

export function queueTaskView(task: ScenarioReviewTask): ScenarioReviewTask {
  if (task.code !== queueTask) return task;
  const progress = reviewsAreIn()
    ? Object.fromEntries(task.reviewers.map((key) => [key, task.slides]))
    : task.progress;
  return state.signed
    ? { ...task, progress, status: "signed", signedOn: "2026-10-15" }
    : { ...task, progress };
}
