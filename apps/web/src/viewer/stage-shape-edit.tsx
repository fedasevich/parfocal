import { useLingui } from "@lingui/react/macro";
import type { EditDraft } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { useEffect, useMemo, useRef } from "react";
import { type AiCell, boundsOf, geometryOf, type Ring } from "../annotations/ai-edit.ts";
import { AiLayer } from "../annotations/ai-layer.tsx";
import { mapOf } from "../annotations/brush.ts";
import { BrushLayer } from "../annotations/brush-layer.tsx";
import { type AnnotationDocument, addShape, createDocument } from "../annotations/document.ts";
import { polygonToGeoJson } from "../annotations/geojson.ts";
import { at, ringCount, ringOf } from "../annotations/shapes.ts";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "./viewer-engine.ts";

export type ShapeTool = "handles" | "brush";

export const ringOfOutline = (outline: readonly number[] | null | undefined): Ring => {
  const ring: [number, number][] = [];
  for (let index = 0; outline && index + 1 < outline.length; index += 2) {
    ring.push([outline[index] ?? 0, outline[index + 1] ?? 0]);
  }
  return ring;
};

const ringArea = (points: Float32Array) => {
  let sum = 0;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const next = (index + 2) % points.length;
    sum += at(points, index) * at(points, next + 1) - at(points, next) * at(points, index + 1);
  }
  return Math.abs(sum) / 2;
};

function largestRing(shape: NonNullable<ReturnType<typeof mapOf>>): Float32Array | null {
  let best: Float32Array | null = null;
  for (let ring = 0; ring < ringCount(shape); ring++) {
    const points = ringOf(shape, ring);
    if (points.length >= 6 && (best === null || ringArea(points) > ringArea(best))) best = points;
  }
  return best;
}

const sameRing = (left: Float32Array, right: Ring) =>
  left.length === right.length * 2 &&
  right.every(([x, y], index) => left[index * 2] === x && left[index * 2 + 1] === y);

const brushDocument = (ring: Ring): AnnotationDocument =>
  addShape(createDocument(), {
    kind: "brush",
    points: Float32Array.from(ring.flat()),
    ringStarts: Uint32Array.from([0, ring.length]),
    classKey: null,
  }).document;

export function StageShapeEdit({
  engine,
  stage,
  object,
  classId,
  ring,
  original,
  edited,
  tool,
  onSave,
  onClose,
  onStep,
}: {
  engine: ViewerEngine;
  stage: HTMLElement;
  object: string;
  classId: string | null;
  ring: Ring;
  original: Ring;
  edited: boolean;
  tool: ShapeTool;
  onSave: (geometry: EditDraft["geometry"]) => void;
  onClose: () => void;
  onStep: (delta: 1 | -1) => void;
}) {
  const escRegistry = useEscRegistry();
  const closing = useRef(onClose);
  closing.current = onClose;
  const cells = useMemo((): AiCell[] => {
    const bounds = boundsOf(ring);
    return [
      {
        object,
        classId,
        ring,
        deleted: false,
        bounds,
        centre: { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2 },
        edited,
        version: null,
        score: null,
        original: { classId: null, ring: original },
      },
    ];
  }, [object, classId, ring, original, edited]);
  const document = useMemo(() => brushDocument(ring), [ring]);
  useEffect(() => {
    if (tool !== "brush") return;
    return escRegistry?.add("vertex", { open: () => true, peel: () => closing.current() });
  }, [tool, escRegistry]);
  if (tool === "brush") {
    return (
      <BrushLayer
        engine={engine}
        stage={stage}
        active
        document={document}
        classKey={null}
        colour="var(--accent)"
        onApply={(next) => {
          const shape = mapOf(next, null);
          const points = shape === null ? null : largestRing(shape);
          if (points === null || sameRing(points, ring)) return;
          onSave(polygonToGeoJson(points));
        }}
      />
    );
  }
  return (
    <AiLayer
      engine={engine}
      stage={stage}
      cells={cells}
      checkOf={() => (edited ? "edited" : "confirmed")}
      selection={[object]}
      selecting
      locked={false}
      tag={null}
      colourOf={() => "var(--accent)"}
      startEditing={object}
      onEditing={(editing) => {
        if (editing === null) closing.current();
      }}
      onPick={(ids) => {
        if (ids.length === 0) closing.current();
      }}
      onReshape={(_, next) => onSave(geometryOf(next))}
      onDelete={() => undefined}
      onStep={onStep}
    />
  );
}

export function StageShapeEditBar({
  object,
  tool,
  edited,
  onTool,
  onRestore,
  onDone,
}: {
  object: string;
  tool: ShapeTool;
  edited: boolean;
  onTool: (tool: ShapeTool) => void;
  onRestore: () => void;
  onDone: () => void;
}) {
  const { t } = useLingui();
  return (
    <fieldset
      data-testid="shape-edit-bar"
      data-tool={tool}
      aria-label={t`Edit the outline of ${object}`}
      className="m-0 flex min-w-0 flex-col gap-2 rounded-ctl border border-line p-3"
    >
      <p className="m-0 text-body-sm text-fg">
        {tool === "handles"
          ? t`Drag a point or the outline of ${object}. Each move is saved as your edit.`
          : t`Paint to add to ${object}, hold Shift to erase. The [ and ] keys change the size.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={tool === "handles" ? "secondary" : "ghost"}
          aria-pressed={tool === "handles"}
          onClick={() => onTool("handles")}
        >
          {t`Move points`}
        </Button>
        <Button
          size="sm"
          variant={tool === "brush" ? "secondary" : "ghost"}
          aria-pressed={tool === "brush"}
          onClick={() => onTool("brush")}
        >
          {t`Brush`}
        </Button>
        {edited ? (
          <Button size="sm" variant="ghost" onClick={onRestore}>
            {t`Restore the AI original`}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t`Done`}
        </Button>
      </div>
    </fieldset>
  );
}
