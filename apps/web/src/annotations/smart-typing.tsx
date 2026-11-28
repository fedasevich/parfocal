import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useSavedAutoTyping } from "../shell/smart-typing-setting.ts";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenScale, slideToScreen } from "../viewer/viewer-engine.ts";
import { type ClassColour, cellTypeText } from "./cell-type.ts";
import { ContextExtra, contextChip } from "./context-extras.tsx";
import type { AnnotationDocument } from "./document.ts";
import { pickShape } from "./hit-test.ts";
import { hitTolerancePx } from "./select-tool.ts";
import type { Shape, ShapeId } from "./shapes.ts";
import { slideAt } from "./stage-pointer.ts";
import { useStageRect } from "./stage-size.ts";
import { type ProposalControls, type TypingState, useProposals } from "./use-proposals.ts";
import type { SavedAnnotations } from "./use-saved-annotations.ts";

type NamedClass = { readonly id: string; readonly name: string; readonly colour: string };

export type CellTypingControls = {
  readonly proposals: ProposalControls;
  readonly autoType: boolean;
  readonly setAutoType: (next: boolean) => void;
  readonly classColour: ClassColour;
  readonly className: (classKey: string) => string | null;
  readonly acceptName: string | null;
  readonly document: AnnotationDocument;
};

export function useCellTyping(
  saved: SavedAnnotations,
  slideId: string,
  classes: readonly NamedClass[],
  activeClass: string | null,
  onAccepted?: (shapes: readonly Shape[]) => void,
): CellTypingControls {
  const [autoType, setAutoType] = useSavedAutoTyping();
  const classOfType = useCallback(
    (type: string) => classes.find((item) => item.name.toLowerCase() === type)?.id ?? null,
    [classes],
  );
  const classColour = useCallback(
    (classKey: string | null) => classes.find((item) => item.id === classKey)?.colour ?? null,
    [classes],
  );
  const className = useCallback(
    (classKey: string) => classes.find((item) => item.id === classKey)?.name ?? null,
    [classes],
  );
  const proposals = useProposals(saved, slideId, {
    autoType,
    classOfType,
    ...(onAccepted === undefined ? {} : { onAccepted }),
  });
  const acceptName = proposals.typesOnAccept
    ? null
    : (classes.find((item) => item.id === activeClass)?.name ?? null);
  return {
    proposals,
    autoType,
    setAutoType,
    classColour,
    className,
    acceptName,
    document: saved.document,
  };
}

export function CellTyping({
  engine,
  stage,
  selected,
  smart,
  typing,
}: {
  engine: ViewerEngine;
  stage: HTMLElement;
  selected: readonly ShapeId[];
  smart: boolean;
  typing: CellTypingControls;
}) {
  return (
    <>
      <CellTypeTag
        engine={engine}
        stage={stage}
        document={typing.document}
        selected={selected}
        className={typing.className}
      />
      {smart ? (
        <SmartTypingBar
          autoType={typing.autoType}
          onAutoTypeChange={typing.setAutoType}
          typing={typing.proposals.typing}
        />
      ) : null}
    </>
  );
}

export function SmartTypingBar({
  autoType,
  onAutoTypeChange,
  typing,
}: {
  autoType: boolean;
  onAutoTypeChange: (next: boolean) => void;
  typing: TypingState;
}) {
  const { t } = useLingui();
  return (
    <ContextExtra>
      <button
        type="button"
        data-testid="smart-auto-type"
        aria-pressed={autoType}
        title={t`Type each cell as soon as it is accepted`}
        onClick={() => onAutoTypeChange(!autoType)}
        className={`${contextChip} cursor-pointer aria-pressed:border-accent`}
      >
        {autoType ? t`Typing on` : t`Typing off`}
      </button>
      {autoType ? (
        <span data-testid="smart-typer" className={contextChip}>
          {t`Cell typer`}
        </span>
      ) : null}
      {typing.state === "idle" ? null : (
        <span
          data-testid="smart-typing"
          data-bar-state=""
          data-state={typing.state}
          role="status"
          className={contextChip}
        >
          {t`Typing ${typing.count} cells`}
        </span>
      )}
    </ContextExtra>
  );
}

export function CellTypeTag({
  engine,
  stage,
  document: doc,
  selected,
  className,
}: {
  engine: ViewerEngine;
  stage: HTMLElement;
  document: AnnotationDocument;
  selected: readonly ShapeId[];
  className: (classKey: string) => string | null;
}) {
  const { t } = useLingui();
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const [hovered, setHovered] = useState<ShapeId | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (event.buttons !== 0) return;
      const point = slideAt(engine, stage, event);
      const tolerance = hitTolerancePx / screenScale(engine.getCamera());
      const shape = pickShape(doc, point, tolerance);
      setHovered(shape !== null && shape.kind === "polygon" ? shape.id : null);
    };
    const leave = () => setHovered(null);
    stage.addEventListener("pointermove", move, { passive: true });
    stage.addEventListener("pointerleave", leave);
    return () => {
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerleave", leave);
    };
  }, [doc, engine, stage]);

  const id = hovered ?? (selected.length === 1 ? (selected[0] ?? null) : null);
  const shape = id === null ? undefined : doc.shapes.get(id);
  if (shape === undefined || shape.kind !== "polygon") return null;
  const text = cellTypeText(shape, className);
  if (text === null) return null;
  const top = slideToScreen(camera, rect, {
    x: (shape.bounds[0] + shape.bounds[2]) / 2,
    y: shape.bounds[1],
  });
  const typed = text.typed;
  return (
    <div
      data-testid="cell-type-tag"
      data-shape={shape.id}
      data-from={hovered === null ? "selection" : "hover"}
      data-type={typed?.type ?? ""}
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-ctl border border-line bg-chrome px-1.5 py-0.5 font-mono text-caption shadow-sm"
      style={{ left: top.x, top: top.y - 6 }}
    >
      <span className="font-semibold capitalize">{text.name}</span>
      {typed === null ? null : (
        <span className="ml-1.5 text-fg-dim">
          {text.changed
            ? t`typer said ${typed.type} ${typed.percent}%`
            : t`typer ${typed.percent}%`}
        </span>
      )}
    </div>
  );
}
