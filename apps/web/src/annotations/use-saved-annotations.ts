import { createAnnotation, listAnnotations } from "@parfocal/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AnnotationDocument, addShape, createDocument } from "./document.ts";
import { polygonPointsOf, polygonToGeoJson, savedPolygonKind } from "./geojson.ts";
import type { ShapeId } from "./shapes.ts";

export type SaveState = "idle" | "saving" | "saved" | "failed";

export type SavedAnnotations = {
  readonly document: AnnotationDocument;
  readonly setDocument: (next: AnnotationDocument) => void;
  readonly savePolygon: (points: Float32Array) => void;
  readonly loaded: boolean;
  readonly saveState: SaveState;
};

export function useSavedAnnotations(slideId: string, enabled: boolean): SavedAnnotations {
  const [document, setDocumentState] = useState(createDocument);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const current = useRef(document);
  const serverIds = useRef(new Map<ShapeId, string>());

  const setDocument = useCallback((next: AnnotationDocument) => {
    current.current = next;
    setDocumentState(next);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void listAnnotations(slideId, { kind: savedPolygonKind }).then(
      (response) => {
        if (cancelled || response.status !== 200) return;
        let next = current.current;
        for (const annotation of response.data) {
          const points = polygonPointsOf(annotation);
          if (points === null) continue;
          const added = addShape(next, { kind: "polygon", points });
          next = added.document;
          serverIds.current.set(added.shape.id, annotation.id);
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

  return { document, setDocument, savePolygon, loaded, saveState };
}
