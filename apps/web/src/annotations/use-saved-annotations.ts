import {
  type AnnotationDraft,
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
} from "@parfocal/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteMarker, dropMarker } from "./count-markers.ts";
import { type AnnotationDocument, addShape, createDocument } from "./document.ts";
import {
  markerPointOf,
  pointToGeoJson,
  polygonPointsOf,
  polygonToGeoJson,
  savedMarkerKind,
  savedPolygonKind,
} from "./geojson.ts";
import {
  canRedo,
  canUndo,
  createHistory,
  type EntryId,
  fold,
  type History,
  record,
  redo,
  undo,
} from "./history.ts";
import type { Point } from "./polygon-draft.ts";
import { at, type Shape, type ShapeId } from "./shapes.ts";

export type SaveState = "idle" | "saving" | "saved" | "failed";

export type SavedAnnotations = {
  readonly document: AnnotationDocument;
  readonly setDocument: (next: AnnotationDocument) => void;
  readonly savePolygon: (points: Float32Array) => void;
  readonly saveMarker: (point: Point, classKey: string | null) => void;
  readonly removeMarker: (id: ShapeId) => void;
  readonly commit: (before: AnnotationDocument, after: AnnotationDocument, label: string) => void;
  readonly undo: () => string | null;
  readonly redo: () => string | null;
  readonly fold: (id: EntryId, change: (doc: AnnotationDocument) => AnnotationDocument) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly loaded: boolean;
  readonly saveState: SaveState;
};

type Stored = { readonly id: string; readonly version: number } | null;

export function useSavedAnnotations(slideId: string, enabled: boolean): SavedAnnotations {
  const [document, setDocumentState] = useState(createDocument);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [history, setHistoryState] = useState(createHistory);
  const current = useRef(document);
  const log = useRef(history);
  const stored = useRef(new Map<ShapeId, Promise<Stored>>());

  const setDocument = useCallback((next: AnnotationDocument) => {
    current.current = next;
    setDocumentState(next);
  }, []);

  const setHistory = useCallback((next: History) => {
    log.current = next;
    setHistoryState(next);
  }, []);

  const createFor = useCallback(
    (shape: Shape) => {
      const body: AnnotationDraft | null =
        shape.kind === "polygon"
          ? { kind: savedPolygonKind, geometry: polygonToGeoJson(shape.points) }
          : shape.kind === "point"
            ? {
                kind: savedMarkerKind,
                geometry: pointToGeoJson({ x: at(shape.points, 0), y: at(shape.points, 1) }),
                class_id: shape.classKey,
              }
            : null;
      if (body === null) return;
      setSaveState("saving");
      const request: Promise<Stored> = createAnnotation(slideId, body).then(
        (response) => {
          if (response.status !== 201) {
            setSaveState("failed");
            return null;
          }
          setSaveState("saved");
          return { id: response.data.id, version: response.data.version };
        },
        () => {
          setSaveState("failed");
          return null;
        },
      );
      stored.current.set(shape.id, request);
    },
    [slideId],
  );

  const deleteFor = useCallback(
    (id: ShapeId) => {
      const pending = stored.current.get(id);
      stored.current.delete(id);
      if (pending === undefined) return;
      setSaveState("saving");
      void pending.then((entry) => {
        if (entry === null) return;
        return deleteAnnotation(slideId, entry.id, { version: entry.version }).then(
          (response) => setSaveState(response.status === 204 ? "saved" : "failed"),
          () => setSaveState("failed"),
        );
      });
    },
    [slideId],
  );

  const sync = useCallback(
    (previous: AnnotationDocument, next: AnnotationDocument) => {
      for (const id of previous.shapes.keys()) {
        if (!next.shapes.has(id)) deleteFor(id);
      }
      for (const [id, shape] of next.shapes) {
        if (!previous.shapes.has(id)) createFor(shape);
      }
    },
    [createFor, deleteFor],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void Promise.all([
      listAnnotations(slideId, { kind: savedPolygonKind }),
      listAnnotations(slideId, { kind: savedMarkerKind }),
    ]).then(
      ([regions, markers]) => {
        if (cancelled || regions.status !== 200) return;
        let next = current.current;
        for (const annotation of regions.data) {
          const points = polygonPointsOf(annotation);
          if (points === null) continue;
          const added = addShape(next, { kind: "polygon", points });
          next = added.document;
          stored.current.set(
            added.shape.id,
            Promise.resolve({ id: annotation.id, version: annotation.version }),
          );
        }
        if (markers.status === 200) {
          for (const annotation of markers.data) {
            const point = markerPointOf(annotation);
            if (point === null) continue;
            const added = dropMarker(next, point, annotation.class_id);
            next = added.document;
            stored.current.set(
              added.shape.id,
              Promise.resolve({ id: annotation.id, version: annotation.version }),
            );
          }
        }
        setDocument(next);
        setLoaded(true);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [slideId, enabled, setDocument]);

  const commit = useCallback(
    (before: AnnotationDocument, after: AnnotationDocument, label: string) => {
      setHistory(record(log.current, before, after, label).history);
    },
    [setHistory],
  );

  const savePolygon = useCallback(
    (points: Float32Array) => {
      const before = current.current;
      const added = addShape(before, { kind: "polygon", points });
      setDocument(added.document);
      commit(before, added.document, "Add outline");
      createFor(added.shape);
    },
    [setDocument, commit, createFor],
  );

  const saveMarker = useCallback(
    (point: Point, classKey: string | null) => {
      const before = current.current;
      const added = dropMarker(before, point, classKey);
      setDocument(added.document);
      commit(before, added.document, "Add marker");
      createFor(added.shape);
    },
    [setDocument, commit, createFor],
  );

  const removeMarker = useCallback(
    (id: ShapeId) => {
      const before = current.current;
      const next = deleteMarker(before, id);
      if (next === before) return;
      setDocument(next);
      commit(before, next, "Remove marker");
      deleteFor(id);
    },
    [setDocument, commit, deleteFor],
  );

  const travel = useCallback(
    (step: typeof undo | typeof redo): string | null => {
      const applied = step(log.current);
      if (applied === null) return null;
      const previous = current.current;
      setHistory(applied.history);
      setDocument(applied.document);
      sync(previous, applied.document);
      return applied.label;
    },
    [setHistory, setDocument, sync],
  );

  const undoLast = useCallback(() => travel(undo), [travel]);
  const redoLast = useCallback(() => travel(redo), [travel]);

  const foldInto = useCallback(
    (id: EntryId, change: (doc: AnnotationDocument) => AnnotationDocument) => {
      const folded = fold(log.current, id, change);
      setHistory(folded.history);
      if (folded.document === null) return;
      const previous = current.current;
      setDocument(folded.document);
      sync(previous, folded.document);
    },
    [setHistory, setDocument, sync],
  );

  return {
    document,
    setDocument,
    savePolygon,
    saveMarker,
    removeMarker,
    commit,
    undo: undoLast,
    redo: redoLast,
    fold: foldInto,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    loaded,
    saveState,
  };
}
