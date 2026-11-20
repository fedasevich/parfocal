import {
  type EditDraft,
  getGetReviewedLayerQueryKey,
  getListReviewEditHistoryQueryKey,
  type ReviewEdit,
  useClearReviewEdit,
  useGetReviewedLayer,
  useSaveReviewEdit,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { ringOfGeometry } from "../screens/review/outline-coords.ts";

export type ReviewFix = {
  readonly classId: string | null;
  readonly geometry: EditDraft["geometry"];
  readonly deleted: boolean;
};

export type ReviewFixes = {
  readonly fixOf: (objectId: string) => ReviewFix | undefined;
  readonly fixed: ReadonlyMap<string, ReviewFix>;
  readonly change: (objectId: string, change: Partial<ReviewFix>) => ReviewFix | undefined;
  readonly restore: (objectId: string, before: ReviewFix | undefined) => void;
};

const fixOfEdit = (edit: ReviewEdit): ReviewFix => ({
  classId: edit.class_id,
  geometry: edit.geometry as EditDraft["geometry"],
  deleted: edit.deleted,
});

export function ringOfFix(fix: ReviewFix | undefined): number[] | null {
  const ring = fix === undefined || fix.deleted ? null : ringOfGeometry(fix.geometry);
  return ring === null || ring.length < 3 ? null : ring.flatMap((point) => [point.x, point.y]);
}

export function useReviewFixes(taskId: string, slideId: string, enabled: boolean): ReviewFixes {
  const queryClient = useQueryClient();
  const layer = okData(
    useGetReviewedLayer(taskId, slideId, undefined, { query: { enabled } }).data,
  );
  const slideKey = `${taskId}/${slideId}`;
  const [kept, setKept] = useState<{
    readonly slide: string;
    readonly fixes: ReadonlyMap<string, ReviewFix | null>;
  }>({ slide: slideKey, fixes: new Map() });
  const local = kept.slide === slideKey ? kept.fixes : null;
  const fixed = useMemo(() => {
    const all = new Map<string, ReviewFix>();
    for (const edit of layer?.edits ?? []) {
      if (edit.retired === null && edit.merged_into === null) all.set(edit.object, fixOfEdit(edit));
    }
    for (const [objectId, fix] of local ?? []) {
      if (fix === null) all.delete(objectId);
      else all.set(objectId, fix);
    }
    return all;
  }, [layer, local]);
  const refresh = (objectId: string) => {
    void queryClient.invalidateQueries({ queryKey: getGetReviewedLayerQueryKey(taskId, slideId) });
    void queryClient.invalidateQueries({
      queryKey: getListReviewEditHistoryQueryKey(taskId, slideId, objectId),
    });
  };
  const saver = useSaveReviewEdit();
  const clearer = useClearReviewEdit();
  const keep = (objectId: string, fix: ReviewFix | null) =>
    setKept((now) => ({
      slide: slideKey,
      fixes: new Map(now.slide === slideKey ? now.fixes : []).set(objectId, fix),
    }));
  const put = (objectId: string, fix: ReviewFix) => {
    keep(objectId, fix);
    saver.mutate(
      {
        taskId,
        slideId,
        objectId,
        data: { class_id: fix.classId, geometry: fix.geometry ?? null, deleted: fix.deleted },
      },
      { onSuccess: () => refresh(objectId) },
    );
  };
  const change = (objectId: string, next: Partial<ReviewFix>) => {
    const before = fixed.get(objectId);
    put(objectId, {
      classId: before?.classId ?? null,
      geometry: before?.geometry ?? null,
      deleted: before?.deleted ?? false,
      ...next,
    });
    return before;
  };
  const restore = (objectId: string, before: ReviewFix | undefined) => {
    if (before !== undefined) {
      put(objectId, before);
      return;
    }
    keep(objectId, null);
    clearer.mutate({ taskId, slideId, objectId }, { onSuccess: () => refresh(objectId) });
  };
  return { fixOf: (objectId) => fixed.get(objectId), fixed, change, restore };
}
