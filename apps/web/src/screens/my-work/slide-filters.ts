import type { ListMySlidesParams, SlideRow, State } from "@parfocal/api-client";

export type SlideFilterValues = {
  project: string | undefined;
  status: State | undefined;
  set: string | undefined;
  reviewer: string | undefined;
};

export type SlideFilterKey = keyof SlideFilterValues;

export type FilterChoice = { value: string; label: string; hint?: string };

export const slideFilterKeys: SlideFilterKey[] = ["project", "status", "set", "reviewer"];

export const statusChoices: (FilterChoice & { value: State })[] = [
  { value: "uploaded", label: "Needs results" },
  { value: "ai-running", label: "AI running" },
  { value: "ready", label: "Ready" },
  { value: "assigned", label: "Assigned" },
  { value: "in-review", label: "In review" },
  { value: "submitted", label: "Submitted" },
  { value: "disagreement-queue", label: "Disagreements" },
  { value: "signed-off", label: "Signed off" },
];

export const slideQuery = (
  filters: SlideFilterValues,
  q: string,
): ListMySlidesParams | undefined => {
  const params: ListMySlidesParams = {
    ...(q ? { q } : {}),
    ...(filters.project ? { project_id: filters.project } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.set ? { result_set: filters.set } : {}),
    ...(filters.reviewer ? { reviewer_id: filters.reviewer } : {}),
  };
  return Object.keys(params).length > 0 ? params : undefined;
};

export const activeFilterCount = (filters: SlideFilterValues) =>
  slideFilterKeys.filter((key) => filters[key] !== undefined).length;

export const withFilter = <Key extends SlideFilterKey>(
  filters: SlideFilterValues,
  key: Key,
  value: SlideFilterValues[Key],
): SlideFilterValues => ({ ...filters, [key]: value });

const uniqueBy = <Item>(items: Item[], keyOf: (item: Item) => string) =>
  Array.from(new Map(items.map((item) => [keyOf(item), item])).values());

export function filterChoices(rows: SlideRow[], reviewerName: (userId: string) => string) {
  const projects = uniqueBy(
    rows.map((row) => row.project),
    (project) => project.id,
  )
    .map((project) => ({ value: project.id, label: project.name, hint: project.code }))
    .sort((a, b) => a.hint.localeCompare(b.hint));
  const sets = uniqueBy(
    rows.flatMap((row) => row.result_sets),
    (set) => set.name,
  )
    .map((set) => ({ value: set.name, label: set.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const reviewers = uniqueBy(
    rows.flatMap((row) => row.reviews),
    (review) => review.user_id,
  )
    .map((review) => ({ value: review.user_id, label: reviewerName(review.user_id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { projects, sets, reviewers };
}
