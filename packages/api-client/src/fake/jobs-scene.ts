import {
  defaultRunModel,
  defaultStartedSlides,
  initialJobsState,
  type JobsState,
} from "./scenario-jobs.ts";

export type FakeJobsScene = "before-run" | "run-started";

let state: JobsState = initialJobsState;

export function fakeJobsState(): JobsState {
  return state;
}

export function updateJobsState(change: (current: JobsState) => JobsState): void {
  state = change(state);
}

export function setFakeJobsScene(next: FakeJobsScene | null): boolean {
  if (next === null) return false;
  if (next === "run-started") {
    if (state.started !== null) return false;
    state = {
      ...initialJobsState,
      started: { slides: defaultStartedSlides(), model: defaultRunModel },
    };
    return true;
  }
  if (state === initialJobsState) return false;
  state = initialJobsState;
  return true;
}

export function resetJobsState(): void {
  state = initialJobsState;
}
