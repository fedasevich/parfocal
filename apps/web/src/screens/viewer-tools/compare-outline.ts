import {
  getListResultSetRegionsQueryOptions,
  type ReviewObject,
  useListReviewObjects,
  useListSlideResultSets,
} from "@parfocal/api-client";
import { useQueries } from "@tanstack/react-query";
import { useRef } from "react";
import type { StillObject } from "../../viewer/still-engine.tsx";
import { useStillObjects } from "../../viewer/use-still-objects.ts";
import { okData } from "../placeholder.tsx";

const noDecision = () => undefined;

const isTumorRegion = (item: ReviewObject) =>
  item.kind === "region" && item.class_name.toLowerCase() === "tumor";

export type SlideOutline = {
  readonly objects: readonly StillObject[];
  readonly available: boolean | undefined;
};

export function useSlideOutline(
  taskId: string,
  slideId: string | undefined,
  wanted: boolean,
): SlideOutline {
  const known = slideId !== undefined;
  const listed = useListReviewObjects(taskId, slideId ?? "", { query: { enabled: known } });
  const sets = useListSlideResultSets(slideId ?? "", { query: { enabled: known } });
  const tumor = (okData(listed.data)?.objects ?? []).filter(isTumorRegion);
  const { objects: taskObjects } = useStillObjects(tumor, noDecision, null);
  const ready = (okData(sets.data) ?? []).filter(
    (set) => set.status === "ready" && set.region_count > 0,
  );
  const ownRegions = wanted && known && tumor.length === 0;
  const fetched = useQueries({
    queries: ready.map((set) => ({
      ...getListResultSetRegionsQueryOptions(set.id),
      enabled: ownRegions,
    })),
  });
  const fromSets = ready.flatMap((set, index): StillObject[] =>
    (okData(fetched[index]?.data)?.regions ?? [])
      .filter((region) => region.outline.length >= 6)
      .map((region) => ({
        id: `${set.id}:region:${region.number}`,
        ring: region.outline,
        inSlide: true,
        className: "tumor",
        score: region.score ?? 1,
        decision: null,
      })),
  );
  const signature = fromSets.map((item) => `${item.id}:${item.score}`).join("|");
  const kept = useRef<{ signature: string; value: readonly StillObject[] } | null>(null);
  if (kept.current?.signature !== signature) kept.current = { signature, value: fromSets };
  const pending = known && (listed.isPending || sets.isPending);
  const available = !known || pending ? undefined : tumor.length > 0 || ready.length > 0;
  return { objects: tumor.length > 0 ? taskObjects : kept.current.value, available };
}
