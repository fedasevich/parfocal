export type StageIssue = "withdrawn" | "slidefail" | "noresults";

export type StageIssueFacts = {
  readonly withdrawn: boolean;
  readonly failedLevels: readonly number[];
  readonly unreadable: boolean;
  readonly resultMissing: boolean;
};

export const highPowerLevels = 2;

export function highPowerFailed(levels: readonly number[]): boolean {
  return levels.some((level) => level < highPowerLevels);
}

export function stageIssueOf(facts: StageIssueFacts): StageIssue | null {
  if (facts.withdrawn) return "withdrawn";
  if (facts.unreadable || highPowerFailed(facts.failedLevels)) return "slidefail";
  if (facts.resultMissing) return "noresults";
  return null;
}

export function isWithdrawn(task: { readonly withdrawn_at?: string | null } | undefined): boolean {
  return task?.withdrawn_at !== undefined && task.withdrawn_at !== null;
}

export type TaskSlideResult = {
  readonly slide_id: string;
  readonly result_set_id: string | null;
};

export function resultMissingOf(
  slides: readonly TaskSlideResult[] | undefined,
  slideId: string,
): boolean {
  const entry = slides?.find((slide) => slide.slide_id === slideId);
  return entry !== undefined && entry.result_set_id === null;
}

export function signedOffOf(
  states:
    | {
        readonly signed_off_at: string | null;
        readonly slides: readonly { readonly slide_id: string; readonly state: string }[];
      }
    | undefined,
  slideId: string,
): { readonly at: string | null } | null {
  if (states === undefined) return null;
  if (states.signed_off_at !== null) return { at: states.signed_off_at };
  const slide = states.slides.find((item) => item.slide_id === slideId);
  return slide?.state === "signed-off" ? { at: null } : null;
}
