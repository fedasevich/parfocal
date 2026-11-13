import { useGetReviewOrder, useListDecisions } from "@parfocal/api-client";
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
  const decisions = okData(
    useListDecisions(taskId ?? "", slideId ?? "", undefined, { query: { enabled: wanted } }).data,
  );
  const order = okData(
    useGetReviewOrder(taskId ?? "", slideId ?? "", undefined, { query: { enabled: wanted } }).data,
  );
  if (decisions === undefined || order === undefined || order.total === 0) return undefined;
  const count = (value: string) => decisions.filter((decision) => decision.value === value).length;
  const decided = decisions.length;
  return {
    decided,
    total: order.total,
    agree: count("agree"),
    disagree: count("disagree"),
    unsure: count("unsure"),
    open: Math.max(0, order.total - decided),
  };
}
