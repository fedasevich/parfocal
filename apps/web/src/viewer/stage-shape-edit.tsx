import { useLingui } from "@lingui/react/macro";
import type { EditDraft } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { useEffect, useMemo, useRef } from "react";
import {
  type AiCell,
  boundsOf,
  geometryOf,
  type PickMode,
  type Ring,
} from "../annotations/ai-edit.ts";
import { AiLayer } from "../annotations/ai-layer.tsx";
import { mapOf } from "../annotations/brush.ts";
import { BrushLayer } from "../annotations/brush-layer.tsx";
import { type AnnotationDocument, addShape, createDocument } from "../annotations/document.ts";
import { partsOf, ringsOfGeometry } from "../annotations/split-merge.ts";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "./viewer-engine.ts";

export type ShapeTool = "handles" | "brush" | "cut" | "merge";

export type MergeCandidate = { readonly object: string; readonly ring: Ring };

export const ringOfOutline = (outline: readonly number[] | null | undefined): Ring => {
  const ring: [number, number][] = [];
  for (let index = 0; outline && index + 1 < outline.length; index += 2) {
    ring.push([outline[index] ?? 0, outline[index + 1] ?? 0]);
  }
  return ring;
};

const sameRing = (left: Ring, right: Ring) =>
  left.length === right.length &&
  right.every(([x, y], index) => left[index]?.[0] === x && left[index]?.[1] === y);

const cellOfRing = (object: string, classId: string | null, ring: Ring, edited: boolean) => {
  const bounds = boundsOf(ring);
  return {
    object,
    classId,
    ring,
    deleted: false,
    bounds,
    centre: { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2 },
    edited,
    version: null,
    score: null,
    original: { classId: null, ring },
  };
};

const picked = (now: readonly string[], ids: readonly string[], mode: PickMode, keep: string) => {
  if (mode === "replace") return [...new Set([keep, ...ids])];
  const next = new Set(now);
  for (const id of ids) {
    if (id === keep) continue;
    if (mode === "toggle" && next.has(id)) next.delete(id);
    else next.add(id);
  }
  return [...next];
};

export const brushDocument = (ring: Ring): AnnotationDocument =>
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
  edited,
  tool,
  candidates = [],
  merging = [],
  onMerging,
  onSave,
  onSplit,
  onClose,
  onStep,
}: {
  engine: ViewerEngine;
  stage: HTMLElement;
  object: string;
  classId: string | null;
  ring: Ring;
  edited: boolean;
  tool: ShapeTool;
  candidates?: readonly MergeCandidate[];
  merging?: readonly string[];
  onMerging?: (objects: readonly string[]) => void;
  onSave: (geometry: EditDraft["geometry"]) => void;
  onSplit?: (parts: readonly Ring[]) => void;
  onClose: () => void;
  onStep: (delta: 1 | -1) => void;
}) {
  const escRegistry = useEscRegistry();
  const closing = useRef(onClose);
  closing.current = onClose;
  const mergeCells = useMemo(
    (): AiCell[] => [
      cellOfRing(object, classId, ring, edited),
      ...candidates
        .filter((item) => item.object !== object)
        .map((item) => cellOfRing(item.object, null, item.ring, false)),
    ],
    [object, classId, ring, edited, candidates],
  );
  const document = useMemo(() => brushDocument(ring), [ring]);
  useEffect(() => {
    if (tool !== "brush" && tool !== "cut") return;
    return escRegistry?.add("vertex", { open: () => true, peel: () => closing.current() });
  }, [tool, escRegistry]);
  if (tool === "brush" || tool === "cut") {
    return (
      <BrushLayer
        engine={engine}
        stage={stage}
        active
        cut={tool === "cut"}
        document={document}
        classKey={null}
        colour="var(--accent)"
        onApply={(next) => {
          const shape = mapOf(next, null);
          const parts = shape === null ? [] : partsOf(ringsOfGeometry(shape));
          if (parts.length >= 2 && onSplit !== undefined) {
            onSplit(parts);
            return;
          }
          const kept = parts[0];
          if (tool === "cut" || kept === undefined || sameRing(kept, ring)) return;
          onSave(geometryOf(kept));
        }}
      />
    );
  }
  if (tool === "merge") {
    const chosen = merging.includes(object) ? merging : [object, ...merging];
    return (
      <AiLayer
        engine={engine}
        stage={stage}
        cells={mergeCells}
        checkOf={() => "confirmed"}
        selection={chosen}
        selecting
        locked={false}
        tag={null}
        colourOf={() => "var(--accent)"}
        onPick={(ids, mode) => onMerging?.(picked(chosen, ids, mode, object))}
        onReshape={() => undefined}
        onDelete={() => undefined}
        onStep={onStep}
      />
    );
  }
  return null;
}

export function StageShapeFateBar({
  object,
  line,
  undoLabel,
  onUndo,
}: {
  object: string;
  line: string;
  undoLabel: string;
  onUndo: () => void;
}) {
  const { t } = useLingui();
  return (
    <fieldset
      data-testid="shape-fate-bar"
      aria-label={t`What happened to ${object}`}
      className="m-0 flex min-w-0 flex-col gap-2 rounded-ctl border border-line p-3"
    >
      <p className="m-0 text-body-sm text-fg">{line}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={onUndo}>
          {undoLabel}
        </Button>
      </div>
    </fieldset>
  );
}

export function StageShapeEditBar({
  object,
  tool,
  edited,
  canSplit = false,
  merging = 0,
  crossing = false,
  asking = false,
  onTool,
  onRestore,
  onMerge,
  onDone,
  onKeepEditing,
  onDiscard,
}: {
  object: string;
  tool: ShapeTool;
  edited: boolean;
  canSplit?: boolean;
  merging?: number;
  crossing?: boolean;
  asking?: boolean;
  onTool: (tool: ShapeTool) => void;
  onRestore: () => void;
  onMerge?: () => void;
  onDone: () => void;
  onKeepEditing?: () => void;
  onDiscard?: () => void;
}) {
  const { t } = useLingui();
  const hints: Record<ShapeTool, string> = {
    handles: t`Drag a point or the outline of ${object}. Drag the dot on an edge to add a point, Alt+click a point or select it and press Backspace to remove it. Done saves the outline once, Esc discards it.`,
    brush: t`Paint to add to ${object}, hold Shift to erase. The [ and ] keys change the size.`,
    cut: t`Draw a line across ${object} to split it into parts.`,
    merge: t`Click the regions to merge with ${object}, then press Merge.`,
  };
  return (
    <fieldset
      data-testid="shape-edit-bar"
      data-tool={tool}
      aria-label={t`Edit the outline of ${object}`}
      className="m-0 flex min-w-0 flex-col gap-2 rounded-ctl border border-line p-3"
    >
      <p className="m-0 text-body-sm text-fg">{hints[tool]}</p>
      {tool === "handles" && crossing ? (
        <p data-testid="outline-crossing" role="status" className="m-0 text-body-sm text-bad">
          {t`Outline crosses itself`}
        </p>
      ) : null}
      {tool === "handles" && asking ? (
        <div data-testid="outline-leave" className="flex flex-col gap-2">
          <p className="m-0 text-body-sm text-fg">
            {t`The outline of ${object} crosses itself, so it cannot be saved. Fix it, or discard the change and go on.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={onKeepEditing}>
              {t`Fix the outline`}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDiscard}>
              {t`Discard the change`}
            </Button>
          </div>
        </div>
      ) : null}
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
        {canSplit ? (
          <>
            <Button
              size="sm"
              variant={tool === "cut" ? "secondary" : "ghost"}
              aria-pressed={tool === "cut"}
              onClick={() => onTool("cut")}
            >
              {t`Split`}
            </Button>
            <Button
              size="sm"
              variant={tool === "merge" ? "secondary" : "ghost"}
              aria-pressed={tool === "merge"}
              onClick={() => onTool("merge")}
            >
              {t`Merge`}
            </Button>
          </>
        ) : null}
        {tool === "merge" ? (
          <Button size="sm" variant="primary" disabled={merging < 2} onClick={onMerge}>
            {t`Merge ${merging} regions`}
          </Button>
        ) : null}
        {edited ? (
          <Button size="sm" variant="ghost" onClick={onRestore}>
            {t`Restore the AI original`}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={tool === "handles" && crossing}
          onClick={onDone}
        >
          {t`Done`}
        </Button>
      </div>
    </fieldset>
  );
}
