import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useHoverPreview } from "../aiseg/hover-preview-setting.ts";
import { createPrewarmTrigger } from "../aiseg/smart-prewarm.ts";
import { nextRunId, smartRunFinished, withSmartRun } from "../aiseg/smart-run.ts";
import { classifyPress, type SmartPoint } from "../aiseg/smart-select.ts";
import type {
  SmartServices,
  SmartServicesContext,
  SmartServicesLoader,
} from "../aiseg/smart-services.ts";
import {
  createSmartSession,
  type SmartPress,
  type SmartSession,
  type SmartSnapshot,
} from "../aiseg/smart-session.ts";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import type { AnnotationDocument } from "./document.ts";
import {
  bindSpacePan,
  capturePointer,
  interruptMotion,
  releasePointer,
  slideAt,
  stagePoint,
} from "./stage-pointer.ts";
import { useStageRect } from "./stage-size.ts";

type SmartLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  slideId: string;
  active: boolean;
  document: AnnotationDocument;
  activeClass: string | null;
  loader: SmartServicesLoader;
  openRequest: SmartServicesContext["open"];
  onDocumentChange: (next: AnnotationDocument) => void;
};

type Press = {
  id: number;
  button: number;
  altKey: boolean;
  shiftKey: boolean;
  start: { x: number; y: number };
  startScreen: { x: number; y: number };
  pointer: { x: number; y: number };
  moved: number;
};

const idle: SmartSnapshot = { kept: [], live: null, phase: "idle", message: null };

const positiveColour = "#1f9d55";
const negativeColour = "#d92d20";
const hoverColour = "#0891b2";

type Where = (point: { x: number; y: number }) => { x: number; y: number };

function ringPath(ring: Float32Array, where: Where): string {
  let path = "";
  for (let i = 0; i < ring.length; i += 2) {
    const at = where({ x: ring[i] ?? 0, y: ring[i + 1] ?? 0 });
    path += `${i === 0 ? "M" : "L"}${at.x.toFixed(1)} ${at.y.toFixed(1)}`;
  }
  return `${path}Z`;
}

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("input, textarea, select, [contenteditable]") !== null
  );
}

export function SmartLayer({
  engine,
  stage,
  slideId,
  active,
  document: doc,
  activeClass,
  loader,
  openRequest,
  onDocumentChange,
}: SmartLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const [snapshot, setSnapshot] = useState<SmartSnapshot>(idle);
  const [press, setPress] = useState<Press | null>(null);
  const [hoverRing, setHoverRing] = useState<Float32Array | null>(null);
  const [hoverOn, setHoverOn] = useHoverPreview();
  const hoverNow = useRef(hoverOn);
  hoverNow.current = hoverOn;
  const escRegistry = useEscRegistry();
  const latest = useRef({ engine, doc, activeClass, onDocumentChange, loader, openRequest });
  latest.current = { engine, doc, activeClass, onDocumentChange, loader, openRequest };
  const runId = useRef<number | null>(null);
  const services = useRef<Promise<SmartServices> | null>(null);
  const session = useRef<Promise<SmartSession> | null>(null);
  const built = useRef(false);

  const shown = useRef<SmartSnapshot>(idle);
  const syncRun = useCallback((next: SmartSnapshot, classKey: string | null) => {
    const pieces = next.kept.length + (next.live?.ring ? 1 : 0);
    if (pieces === 0 && runId.current === null) return;
    const current = latest.current;
    if (runId.current === null) runId.current = nextRunId(current.doc);
    built.current = pieces > 0;
    const changed = withSmartRun(current.doc, runId.current, classKey, next);
    if (pieces === 0) runId.current = null;
    if (changed === current.doc) return;
    current.doc = changed;
    current.onDocumentChange(changed);
  }, []);
  const show = useCallback(
    (next: SmartSnapshot) => {
      shown.current = next;
      setSnapshot(next);
      syncRun(next, latest.current.activeClass);
    },
    [syncRun],
  );

  const sessionPromise = useCallback((): Promise<SmartSession> => {
    if (session.current === null) {
      const slide = latest.current.engine.getSlide();
      const context: SmartServicesContext = {
        slide: { width: slide?.width ?? 0, height: slide?.height ?? 0 },
        open: latest.current.openRequest,
      };
      services.current = latest.current.loader(context);
      session.current = services.current.then((loaded) =>
        createSmartSession({
          slideId,
          reader: loaded.reader,
          sam: loaded.sam,
          onChange: show,
          onHover: setHoverRing,
        }),
      );
      session.current.catch((error: unknown) =>
        show({
          ...idle,
          phase: "failed",
          message: error instanceof Error ? error.message : "Smart select could not start",
        }),
      );
    }
    return session.current;
  }, [slideId, show]);

  useEffect(
    () => () => {
      const pending = session.current;
      const loaded = services.current;
      session.current = null;
      services.current = null;
      void pending?.then((value) => value.close());
      void loaded?.then((value) => value.close());
    },
    [],
  );

  useEffect(() => {
    syncRun(shown.current, activeClass);
  }, [activeClass, syncRun]);

  useEffect(() => {
    const id = runId.current;
    if (id === null || !built.current || !smartRunFinished(doc, id)) return;
    runId.current = null;
    built.current = false;
    void session.current?.then((value) => value.reset());
  }, [doc]);

  useEffect(() => {
    if (!active) return;
    const trigger = createPrewarmTrigger({
      pause: () => void session.current?.then((value) => value.pausePrewarm()),
      fire: () => {
        const centre = screenToSlide(camera, rect, rect.width / 2, rect.height / 2);
        void sessionPromise().then((value) => value.prewarm(centre));
      },
    });
    trigger.touch();
    return () => trigger.stop();
  }, [active, camera, rect, sessionPromise]);

  useEffect(() => {
    if (active && hoverOn) return;
    setHoverRing(null);
    void session.current?.then((value) => value.clearHover());
  }, [active, hoverOn]);

  useEffect(() => {
    if (!active) {
      setPress(null);
      return;
    }
    let current: Press | null = null;
    const send = (action: (value: SmartSession) => Promise<void>) => {
      void sessionPromise().then(action);
    };
    const pan = bindSpacePan(stage, {
      engine: () => latest.current.engine,
      gesturing: () => current !== null,
    });
    const down = (event: PointerEvent) => {
      if ((event.button !== 0 && event.button !== 2) || current !== null || pan.held()) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      interruptMotion(latest.current.engine);
      capturePointer(stage, event.pointerId);
      void session.current?.then((value) => value.clearHover());
      current = {
        id: event.pointerId,
        button: event.button,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        start: slideAt(latest.current.engine, stage, event),
        startScreen: stagePoint(stage, event),
        pointer: stagePoint(stage, event),
        moved: 0,
      };
      setPress(current);
    };
    const move = (event: PointerEvent) => {
      if (current === null || event.pointerId !== current.id) {
        pan.track(event);
        if (current === null && hoverNow.current && !pan.held() && event.buttons === 0) {
          const at = slideAt(latest.current.engine, stage, event);
          void session.current?.then((value) => value.hover(at, event.shiftKey));
        }
        return;
      }
      event.stopImmediatePropagation();
      if (pan.steer(event)) return;
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
    const up = (event: PointerEvent) => {
      if (current === null || event.pointerId !== current.id) return;
      event.stopImmediatePropagation();
      const finished = current;
      current = null;
      pan.release();
      releasePointer(stage, event.pointerId);
      setPress(null);
      const gesture = classifyPress({
        button: finished.button,
        altKey: finished.altKey,
        shiftKey: finished.shiftKey,
        movedScreenPixels: finished.moved,
      });
      if (gesture === null) return;
      const end = slideAt(latest.current.engine, stage, event);
      const request: SmartPress =
        gesture.kind === "box"
          ? { kind: "box", from: finished.start, to: end }
          : {
              kind: "point",
              at: finished.start,
              positive: gesture.positive,
              extend: gesture.extend,
            };
      send((value) => value.press(request));
    };
    const leave = () => void session.current?.then((value) => value.clearHover());
    const cancel = (event: PointerEvent) => {
      if (current === null || event.pointerId !== current.id) return;
      current = null;
      pan.release();
      setPress(null);
    };
    const menu = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const doubleClick = (event: MouseEvent) => {
      event.stopImmediatePropagation();
      event.preventDefault();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" || event.defaultPrevented || typing(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (session.current === null) return;
      event.preventDefault();
      send((value) => value.removeLast());
    };
    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    stage.addEventListener("pointerleave", leave, true);
    stage.addEventListener("pointercancel", cancel, true);
    stage.addEventListener("lostpointercapture", cancel, true);
    stage.addEventListener("contextmenu", menu, true);
    stage.addEventListener("dblclick", doubleClick, true);
    window.addEventListener("keydown", key);
    const leaveRung = escRegistry?.add("drag", {
      open: () => current !== null,
      peel: () => {
        current = null;
        pan.release();
        setPress(null);
      },
    });
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerup", up, true);
      stage.removeEventListener("pointerleave", leave, true);
      stage.removeEventListener("pointercancel", cancel, true);
      stage.removeEventListener("lostpointercapture", cancel, true);
      stage.removeEventListener("contextmenu", menu, true);
      stage.removeEventListener("dblclick", doubleClick, true);
      window.removeEventListener("keydown", key);
      pan.dispose();
      leaveRung?.();
    };
  }, [active, stage, escRegistry, sessionPromise]);

  const live = snapshot.live;
  const prompts = live?.prompts ?? { points: [], box: null };
  const where = (point: { x: number; y: number }) => slideToScreen(camera, rect, point);
  const boxCorners =
    prompts.box === null || !active
      ? null
      : {
          a: where({ x: prompts.box.x0, y: prompts.box.y0 }),
          b: where({ x: prompts.box.x1, y: prompts.box.y1 }),
        };
  const dragBox =
    press !== null && press.button === 0 && press.moved > 4
      ? {
          a: where(press.start),
          b: where(screenToSlide(camera, rect, press.pointer.x, press.pointer.y)),
        }
      : null;
  const negatives = prompts.points.filter((point) => !point.positive).length;
  const marker = (point: SmartPoint, index: number) => {
    const at = where(point);
    return (
      <g key={index} data-testid={point.positive ? "smart-positive" : "smart-negative"}>
        <circle cx={at.x} cy={at.y} r={6} fill="#fff" />
        <circle cx={at.x} cy={at.y} r={4} fill={point.positive ? positiveColour : negativeColour} />
      </g>
    );
  };
  const frame = (corners: { a: { x: number; y: number }; b: { x: number; y: number } }) => ({
    x: Math.min(corners.a.x, corners.b.x),
    y: Math.min(corners.a.y, corners.b.y),
    width: Math.abs(corners.b.x - corners.a.x),
    height: Math.abs(corners.b.y - corners.a.y),
  });

  return (
    <>
      <svg
        data-testid="smart-layer"
        data-active={active ? "true" : "false"}
        data-phase={snapshot.phase}
        data-points={prompts.points.length}
        data-negatives={negatives}
        data-box={prompts.box === null ? 0 : 1}
        data-kept={snapshot.kept.length}
        data-live={live?.ring ? 1 : 0}
        data-hover={hoverRing === null ? 0 : 1}
        data-confidence={live?.ring ? live.confidence.toFixed(2) : undefined}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        {boxCorners === null ? null : (
          <rect
            data-testid="smart-box"
            {...frame(boxCorners)}
            fill="none"
            stroke={positiveColour}
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        )}
        {dragBox === null ? null : (
          <rect
            data-testid="smart-box-preview"
            {...frame(dragBox)}
            fill="none"
            className="stroke-accent"
            strokeWidth={2}
          />
        )}
        {active ? prompts.points.map(marker) : null}
        {active && hoverOn && hoverRing !== null ? (
          <path
            data-testid="smart-hover"
            d={ringPath(hoverRing, where)}
            fill="none"
            stroke={hoverColour}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        ) : null}
      </svg>
      {active ? (
        <button
          type="button"
          data-testid="smart-hover-toggle"
          aria-pressed={hoverOn}
          onClick={() => setHoverOn(!hoverOn)}
          className="absolute bottom-16 left-3 rounded-ctl border border-line bg-chrome px-2 py-1 font-mono text-caption aria-pressed:border-accent"
        >
          {hoverOn ? "Hover preview on" : "Hover preview off"}
        </button>
      ) : null}
      {active && (snapshot.phase === "thinking" || snapshot.message !== null) ? (
        <div
          data-testid="smart-status"
          role="status"
          className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-ctl border border-line bg-chrome px-3 py-1.5 font-mono text-caption"
        >
          {snapshot.phase === "thinking" ? "Outlining" : snapshot.message}
        </div>
      ) : null}
    </>
  );
}
