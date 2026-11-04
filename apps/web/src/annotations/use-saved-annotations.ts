import { createAnnotation, deleteAnnotation, listAnnotations } from "@parfocal/api-client";
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
import type { Point } from "./polygon-draft.ts";
import type { ShapeId } from "./shapes.ts";

export type SaveState = "idle" | "saving" | "saved" | "failed";

export type SavedAnnotations = {
  readonly document: AnnotationDocument;
  readonly setDocument: (next: AnnotationDocument) => void;
  readonly savePolygon: (points: Float32Array) => void;
  readonly saveMarker: (point: Point, classKey: string | null) => void;
  readonly removeMarker: (id: ShapeId) => void;
  readonly loaded: boolean;
  readonly saveState: SaveState;
};

export function useSavedAnnotations(slideId: string, enabled: boolean): SavedAnnotations {
  const [document, setDocumentState] = useState(createDocument);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const current = useRef(document);
  const serverIds = useRef(new Map<ShapeId, string>());
  const versions = useRef(new Map<ShapeId, number>());

  const setDocument = useCallback((next: AnnotationDocument) => {
    current.current = next;
    setDocumentState(next);
  }, []);

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
          serverIds.current.set(added.shape.id, annotation.id);
        }
        if (markers.status === 200) {
          for (const annotation of markers.data) {
            const point = markerPointOf(annotation);
            if (point === null) continue;
            const added = dropMarker(next, point, annotation.class_id);
            next = added.document;
            serverIds.current.set(added.shape.id, annotation.id);
            versions.current.set(added.shape.id, annotation.version);
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

  const savePolygon = useCallback(
    (points: Float32Array) => {
      const added = addShape(current.current, { kind: "polygon", points });
      setDocument(added.document);
      setSaveState("saving");
      createAnnotation(slideId, {
        kind: savedPolygonKind,
        geometry: polygonToGeoJson(added.shape.points),
      }).then(
        (response) => {
          if (response.status !== 201) {
            setSaveState("failed");
            return;
          }
          serverIds.current.set(added.shape.id, response.data.id);
          setSaveState("saved");
        },
        () => setSaveState("failed"),
      );
    },
    [slideId, setDocument],
  );

  const saveMarker = useCallback(
    (point: Point, classKey: string | null) => {
      const added = dropMarker(current.current, point, classKey);
      setDocument(added.document);
      setSaveState("saving");
      createAnnotation(slideId, {
        kind: savedMarkerKind,
        geometry: pointToGeoJson(point),
        class_id: classKey,
      }).then(
        (response) => {
          if (response.status !== 201) {
            setSaveState("failed");
            return;
          }
          serverIds.current.set(added.shape.id, response.data.id);
          versions.current.set(added.shape.id, response.data.version);
          setSaveState("saved");
        },
        () => setSaveState("failed"),
      );
    },
    [slideId, setDocument],
  );

  const removeMarker = useCallback(
    (id: ShapeId) => {
      const next = deleteMarker(current.current, id);
      if (next === current.current) return;
      setDocument(next);
      const serverId = serverIds.current.get(id);
      serverIds.current.delete(id);
      if (serverId === undefined) return;
      setSaveState("saving");
      deleteAnnotation(slideId, serverId, { version: versions.current.get(id) ?? 1 }).then(
        (response) => setSaveState(response.status === 204 ? "saved" : "failed"),
        () => setSaveState("failed"),
      );
    },
    [slideId, setDocument],
  );

  return { document, setDocument, savePolygon, saveMarker, removeMarker, loaded, saveState };
}
