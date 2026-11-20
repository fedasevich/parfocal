import type { DatasetOrigin, GetTaskDatasetParams, ProjectClass } from "@parfocal/api-client";

export const checkedOrigins = [
  "human",
  "ai-confirmed",
  "ai-edited",
] as const satisfies readonly DatasetOrigin[];

export type CheckedOrigin = (typeof checkedOrigins)[number];

export const unclassedKey = "none";

export type PageFilters = {
  readonly origins: readonly CheckedOrigin[];
  readonly classIds: readonly string[] | null;
  readonly slideIds: readonly string[] | null;
  readonly includeUnchecked: boolean;
};

export const startingFilters: PageFilters = {
  origins: checkedOrigins,
  classIds: null,
  slideIds: null,
  includeUnchecked: false,
};

export function toggled<Item>(list: readonly Item[], item: Item): Item[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}

export function narrowed(
  chosen: readonly string[] | null,
  all: readonly string[],
  item: string,
): string[] | null {
  const next = toggled(chosen ?? all, item);
  if (next.length === 0) return chosen === null ? null : [...chosen];
  return all.every((entry) => next.includes(entry)) ? null : next;
}

export function datasetParams(filters: PageFilters): GetTaskDatasetParams {
  return {
    ...(filters.origins.length === checkedOrigins.length ? {} : { origin: [...filters.origins] }),
    ...(filters.classIds === null ? {} : { class_id: [...filters.classIds] }),
    ...(filters.slideIds === null ? {} : { slide_id: [...filters.slideIds] }),
    include_unchecked: filters.includeUnchecked,
  };
}

export function freezeFilters(filters: PageFilters) {
  return {
    origins: [...filters.origins],
    class_ids: filters.classIds === null ? null : [...filters.classIds],
    slide_ids: filters.slideIds === null ? null : [...filters.slideIds],
    include_unchecked: filters.includeUnchecked,
  };
}

export function totalOf(objects: Partial<Record<DatasetOrigin, number>>): number {
  return Object.values(objects).reduce<number>((sum, count) => sum + (count ?? 0), 0);
}

export function className(
  key: string,
  classes: readonly ProjectClass[],
  unclassed: string,
): string {
  if (key === unclassedKey) return unclassed;
  return classes.find((item) => item.id === key)?.name ?? key.slice(0, 8);
}

export function shortChecksum(sha256: string): string {
  return sha256.slice(0, 12);
}

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
