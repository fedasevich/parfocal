import { useState } from "react";
import { closeDraft, minimumVertices, type PolygonDraft } from "../../annotations/polygon-draft.ts";
import type { StageDraw } from "../../viewer/object-stage.tsx";

export type OutlineDrawing = {
  readonly drawingKey: string | null;
  readonly points: number;
  readonly canFinish: boolean;
  readonly start: (key: string) => void;
  readonly stop: () => void;
  readonly stageDraw: (key: string, onSettle: (points: Float32Array) => void) => StageDraw | null;
  readonly finish: (onSettle: (points: Float32Array) => void) => void;
};

export function useOutlineDrawing(): OutlineDrawing {
  const [drawingKey, setDrawingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<PolygonDraft>([]);
  const start = (key: string) => {
    setDraft([]);
    setDrawingKey(key);
  };
  const stop = () => {
    setDraft([]);
    setDrawingKey(null);
  };
  const settleWith = (onSettle: (points: Float32Array) => void) => (points: Float32Array) => {
    stop();
    onSettle(points);
  };
  return {
    drawingKey,
    points: draft.length,
    canFinish: draft.length >= minimumVertices,
    start,
    stop,
    stageDraw: (key, onSettle) =>
      drawingKey === key
        ? { draft, onDraft: setDraft, onClose: settleWith(onSettle), onCancel: stop }
        : null,
    finish: (onSettle) => {
      const step = closeDraft(draft);
      if (step.kind === "closed") settleWith(onSettle)(step.points);
    },
  };
}
