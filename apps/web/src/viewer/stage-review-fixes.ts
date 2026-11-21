import {
  clearReviewEdit,
  type EditDraft,
  getGetReviewedLayerQueryKey,
  getListReviewEditHistoryQueryKey,
  getListReviewObjectsQueryKey,
  mergeReviewObjects,
  type ReviewEdit,
  splitReviewObject,
  useClearReviewEdit,
  useGetReviewedLayer,
  useSaveReviewEdit,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { geometryOf, type Ring } from "../annotations/ai-edit.ts";
import { okData } from "../screens/placeholder.tsx";
import { ringOfGeometry } from "../screens/review/outline-coords.ts";

export type ReviewFix = {
  readonly classId: string | null;
  readonly geometry: EditDraft["geometry"];
  readonly deleted: boolean;
};

export type ReviewPart = { readonly object: string; readonly outline: number[] };

export type ReviewFate =
  | { readonly kind: "split"; readonly parts: readonly ReviewPart[] }
  | { readonly kind: "merged"; readonly into: string };

export type ReviewFixes = {
  readonly fixOf: (objectId: string) => ReviewFix | undefined;
  readonly fixed: ReadonlyMap<string, ReviewFix>;
  readonly fates: ReadonlyMap<string, ReviewFate>;
  readonly change: (objectId: string, change: Partial<ReviewFix>) => ReviewFix | undefined;
  readonly restore: (objectId: string, before: ReviewFix | undefined) => void;
  readonly split: (objectId: string, parts: readonly Ring[]) => Promise<boolean>;
  readonly merge: (objects: readonly string[], outline: Ring) => Promise<boolean>;
  readonly unsplit: (objectId: string) => Promise<boolean>;
};

const parentOf = (object: string) => object.replace(/[a-z]+$/, "");

export function fatesOf(edits: readonly ReviewEdit[]): Map<string, ReviewFate> {
  const fates = new Map<string, ReviewFate>();
  for (const edit of edits) {
    if (edit.merged_into !== null)
      fates.set(edit.object, { kind: "merged", into: edit.merged_into });
  }
  for (const edit of edits) {
    const parent = parentOf(edit.object);
    if (parent === edit.object || edit.retired !== null || edit.merged_into !== null) continue;
    const outline = ringOfFix(fixOfEdit(edit));
    if (outline === null) continue;
    const now = fates.get(parent);
    const parts = now?.kind === "split" ? now.parts : [];
    fates.set(parent, { kind: "split", parts: [...parts, { object: edit.object, outline }] });
  }
  return fates;
}

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
  const fates = useMemo(() => fatesOf(layer?.edits ?? []), [layer]);
  const refresh = (objectId: string) => {
    void queryClient.invalidateQueries({ queryKey: getGetReviewedLayerQueryKey(taskId, slideId) });
    void queryClient.invalidateQueries({
      queryKey: getListReviewObjectsQueryKey(taskId, slideId),
    });
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
  const settled = async (objectIds: readonly string[], request: Promise<unknown>) => {
    try {
      await request;
      return true;
    } catch {
      return false;
    } finally {
      setKept((now) => {
        const fixes = new Map(now.slide === slideKey ? now.fixes : []);
        for (const objectId of objectIds) fixes.delete(objectId);
        return { slide: slideKey, fixes };
      });
      for (const objectId of objectIds) refresh(objectId);
    }
  };
  const split = (objectId: string, parts: readonly Ring[]) =>
    settled(
      [objectId],
      splitReviewObject(taskId, slideId, objectId, {
        parts: parts.map((ring) => ({ geometry: geometryOf(ring) })),
      }),
    );
  const merge = (objects: readonly string[], outline: Ring) =>
    settled(
      objects,
      mergeReviewObjects(taskId, slideId, { objects: [...objects], geometry: geometryOf(outline) }),
    );
  const unsplit = (objectId: string) =>
    settled([objectId], clearReviewEdit(taskId, slideId, objectId));
  return {
    fixOf: (objectId) => fixed.get(objectId),
    fixed,
    fates,
    change,
    restore,
    split,
    merge,
    unsplit,
  };
}
