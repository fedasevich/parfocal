import { startTransition, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type AisOutliner, createAisOutliner } from "../aiseg/ais-outliner.ts";
import {
  clickTile,
  planRegionTiles,
  type RegionNucleus,
  RegionPassAbortedError,
  type RegionProgress,
  runRegionPass,
} from "../aiseg/region-pass.ts";
import { nextRunId } from "../aiseg/smart-run.ts";
import type {
  SmartServices,
  SmartServicesContext,
  SmartServicesLoader,
} from "../aiseg/smart-services.ts";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import { type AnnotationDocument, addRun, removeRun } from "./document.ts";
import { runFromProposals } from "./runs.ts";
import {
  buttonReleased,
  capturePointer,
  interruptMotion,
  keepCapture,
  releasePointer,
  slideAt,
  stagePoint,
} from "./stage-pointer.ts";
import { useStageRect } from "./stage-size.ts";

export const autoModel = "pathosam-ais";
export const autoSource = "auto-region";
export const maxAutoTiles = 64;
const dragThreshold = 4;

type AutoLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  activeClass: string | null;
  loader: SmartServicesLoader;
  openRequest: SmartServicesContext["open"];
  onDocumentChange: (next: AnnotationDocument) => void;
};

type Press = {
  id: number;
  start: { x: number; y: number };
  startScreen: { x: number; y: number };
  pointer: { x: number; y: number };
  moved: number;
};

type Status = {
  progress: RegionProgress | null;
  message: string | null;
};

const idle: Status = { progress: null, message: null };

function runOf(id: number, classKey: string | null, nuclei: readonly RegionNucleus[]) {
  return runFromProposals(
    { id, model: autoModel, label: "Auto region", source: autoSource, classKey },
    nuclei.map((nucleus) => ({ points: nucleus.ring, confidence: nucleus.score })),
  );
}

export function AutoLayer({
  engine,
  stage,
  active,
  document: doc,
  activeClass,
  loader,
  openRequest,
  onDocumentChange,
}: AutoLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const [press, setPress] = useState<Press | null>(null);
  const [status, setStatus] = useState<Status>(idle);
  const escRegistry = useEscRegistry();
  const latest = useRef({ engine, doc, activeClass, onDocumentChange, loader, openRequest });
  latest.current = { engine, doc, activeClass, onDocumentChange, loader, openRequest };
  const services = useRef<Promise<SmartServices> | null>(null);
  const outliner = useRef<AisOutliner | null>(null);
  const controller = useRef<AbortController | null>(null);
  const runId = useRef<number | null>(null);
  const found = useRef<readonly RegionNucleus[]>([]);

  const writeRun = (classKey: string | null) => {
    const id = runId.current;
    if (id === null) return;
    const current = latest.current;
    const next =
      found.current.length === 0
        ? removeRun(current.doc, id)
        : addRun(current.doc, runOf(id, classKey, found.current));
    if (next === current.doc) return;
    current.doc = next;
    startTransition(() => current.onDocumentChange(next));
  };
  const writeRunNow = useRef(writeRun);
  writeRunNow.current = writeRun;

  useEffect(() => {
    if (!active || controller.current === null) return;
    writeRunNow.current(activeClass);
  }, [active, activeClass]);

  useEffect(
    () => () => {
      controller.current?.abort();
      const loaded = services.current;
      services.current = null;
      void loaded?.then((value) => value.close());
      outliner.current?.close();
      outliner.current = null;
    },
    [],
  );

  const start = useRef(async (kind: "drag" | "click", from: Press["start"], to: Press["start"]) => {
    if (controller.current !== null) return;
    const abort = new AbortController();
    controller.current = abort;
    found.current = [];
    runId.current = nextRunId(latest.current.doc);
    setStatus({ progress: null, message: null });
    try {
      const slide = latest.current.engine.getSlide();
      const context: SmartServicesContext = {
        slide: { width: slide?.width ?? 0, height: slide?.height ?? 0 },
        open: latest.current.openRequest,
      };
      services.current ??= latest.current.loader(context);
      const loaded = await services.current;
      const plan = await loaded.plan("nuclei");
      const tiles =
        kind === "click"
          ? [clickTile(from)]
          : planRegionTiles(
              {
                x: Math.min(from.x, to.x),
                y: Math.min(from.y, to.y),
                width: Math.abs(to.x - from.x),
                height: Math.abs(to.y - from.y),
              },
              plan,
            );
      if (tiles.length > maxAutoTiles) {
        setStatus({ progress: null, message: "That area is too large, drag a smaller one" });
        return;
      }
      outliner.current ??= createAisOutliner();
      await runRegionPass({
        tiles,
        preset: "nuclei",
        reader: loaded.reader,
        sam: loaded.sam,
        signal: abort.signal,
        outline: outliner.current.outline,
        pixels: outliner.current.pixels,
        onProgress: (progress) => setStatus({ progress, message: null }),
        onTile: (nuclei) => {
          found.current = [...found.current, ...nuclei];
          writeRunNow.current(latest.current.activeClass);
        },
      });
      setStatus({
        progress: null,
        message: found.current.length === 0 ? "No nuclei found here" : null,
      });
    } catch (error) {
      if (error instanceof RegionPassAbortedError) setStatus(idle);
      else
        setStatus({
          progress: null,
          message: error instanceof Error ? error.message : "Auto region could not run",
        });
    } finally {
      controller.current = null;
      runId.current = null;
      found.current = [];
    }
  });

  useEffect(() => {
    if (!active) {
      setPress(null);
      return;
    }
    let current: Press | null = null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || current !== null || controller.current !== null) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      interruptMotion(latest.current.engine);
      capturePointer(stage, event.pointerId);
      current = {
        id: event.pointerId,
        start: slideAt(latest.current.engine, stage, event),
        startScreen: stagePoint(stage, event),
        pointer: stagePoint(stage, event),
        moved: 0,
      };
      setPress(current);
    };
    const up = (event: PointerEvent) => {
      if (current === null || event.pointerId !== current.id) return;
      event.stopImmediatePropagation();
      const finished = current;
      current = null;
      releasePointer(stage, event.pointerId);
      setPress(null);
      const end = slideAt(latest.current.engine, stage, event);
      const drag = finished.moved > dragThreshold;
      void start.current(drag ? "drag" : "click", finished.start, drag ? end : finished.start);
    };
    const move = (event: PointerEvent) => {
      if (current === null || event.pointerId !== current.id) return;
      event.stopImmediatePropagation();
      if (buttonReleased(event)) {
        up(event);
        return;
      }
      const pointer = stagePoint(stage, event);
      current = {
        ...current,
        pointer,
        moved: Math.max(
          current.moved,
          Math.hypot(pointer.x - current.startScreen.x, pointer.y - current.startScreen.y),
        ),
      };
      setPress(current);
    };
    const cancel = (event: PointerEvent) => {
      if (current === null || event.pointerId !== current.id) return;
      current = null;
      setPress(null);
    };
    const lost = keepCapture(stage, (id) => current?.id === id, cancel);
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    stage.addEventListener("pointercancel", cancel, true);
    stage.addEventListener("lostpointercapture", lost, true);
    stage.addEventListener("contextmenu", swallow, true);
    stage.addEventListener("dblclick", swallow, true);
    const leaveRung = escRegistry?.add("drag", {
      open: () => current !== null || controller.current !== null,
      peel: () => {
        current = null;
        setPress(null);
        controller.current?.abort();
      },
    });
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerup", up, true);
      stage.removeEventListener("pointercancel", cancel, true);
      stage.removeEventListener("lostpointercapture", lost, true);
      stage.removeEventListener("contextmenu", swallow, true);
      stage.removeEventListener("dblclick", swallow, true);
      leaveRung?.();
    };
  }, [active, stage, escRegistry]);

  const dragBox =
    press !== null && press.moved > dragThreshold
      ? (() => {
          const a = slideToScreen(camera, rect, press.start);
          const b = screenToSlide(camera, rect, press.pointer.x, press.pointer.y);
          const bScreen = slideToScreen(camera, rect, b);
          return {
            x: Math.min(a.x, bScreen.x),
            y: Math.min(a.y, bScreen.y),
            width: Math.abs(bScreen.x - a.x),
            height: Math.abs(bScreen.y - a.y),
          };
        })()
      : null;
  const progress = status.progress;

  return (
    <>
      <svg
        data-testid="auto-layer"
        data-active={active ? "true" : "false"}
        data-running={progress === null ? "false" : "true"}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        {dragBox === null || !active ? null : (
          <rect
            data-testid="auto-box-preview"
            {...dragBox}
            fill="none"
            className="stroke-accent"
            strokeWidth={2}
          />
        )}
      </svg>
      {active && (progress !== null || status.message !== null) ? (
        <div
          data-testid="auto-status"
          role="status"
          data-done={progress?.done}
          data-total={progress?.total}
          data-found={progress?.found}
          className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-ctl border border-line bg-chrome px-3 py-1.5 font-mono text-caption"
        >
          {progress !== null
            ? `Tile ${Math.min(progress.done + 1, progress.total)} of ${progress.total} · ${progress.found} found`
            : status.message}
        </div>
      ) : null}
    </>
  );
}
