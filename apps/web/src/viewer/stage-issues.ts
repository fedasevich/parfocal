export type StageIssue = "withdrawn" | "slidefail" | "noresults" | "nothingfound";

export type StageIssueFacts = {
  readonly withdrawn: boolean;
  readonly failedLevels: readonly number[];
  readonly unreadable: boolean;
  readonly resultMissing: boolean;
  readonly nothingFound?: boolean;
};

export const highPowerLevels = 2;

export function highPowerFailed(levels: readonly number[]): boolean {
  return levels.some((level) => level < highPowerLevels);
}

export function stageIssueOf(facts: StageIssueFacts): StageIssue | null {
  if (facts.withdrawn) return "withdrawn";
  if (facts.unreadable || highPowerFailed(facts.failedLevels)) return "slidefail";
  if (facts.resultMissing) return "noresults";
  if (facts.nothingFound === true) return "nothingfound";
  return null;
}

export function nothingFoundOf(objects: { readonly objects: readonly unknown[] } | undefined) {
  return objects !== undefined && objects.objects.length === 0;
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

export type TaskSlideReviewers = {
  readonly slide_id: string;
  readonly reviewer_ids: readonly string[];
};

export function othersReviewOf(
  slides: readonly TaskSlideReviewers[] | undefined,
  slideId: string,
  me: string | null | undefined,
): readonly string[] | null {
  if (me === null || me === undefined) return null;
  const entry = slides?.find((slide) => slide.slide_id === slideId);
  if (entry === undefined || entry.reviewer_ids.includes(me)) return null;
  return entry.reviewer_ids;
}
