import { useGetReviewOrder, useListVerdicts } from "@parfocal/api-client";
import { okData } from "./placeholder.tsx";

export type SlideProgress = {
  decided: number;
  total: number;
  agree: number;
  disagree: number;
  unsure: number;
  open: number;
};

export function useSlideProgress(
  taskId: string | undefined,
  slideId: string | undefined,
): SlideProgress | undefined {
  const wanted = Boolean(taskId) && Boolean(slideId);
  const verdicts = okData(
    useListVerdicts(taskId ?? "", slideId ?? "", undefined, { query: { enabled: wanted } }).data,
  );
  const order = okData(
    useGetReviewOrder(taskId ?? "", slideId ?? "", undefined, { query: { enabled: wanted } }).data,
  );
  if (verdicts === undefined || order === undefined || order.total === 0) return undefined;
  const count = (value: string) => verdicts.filter((verdict) => verdict.value === value).length;
  const decided = verdicts.length;
  return {
    decided,
    total: order.total,
    agree: count("agree"),
    disagree: count("disagree"),
    unsure: count("unsure"),
    open: Math.max(0, order.total - decided),
  };
}
