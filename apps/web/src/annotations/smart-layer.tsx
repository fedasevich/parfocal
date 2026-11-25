import { useLingui } from "@lingui/react/macro";
import { isTwoFingerClick, secondaryButton } from "@parfocal/viewer-engine";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useHoverPreview } from "../aiseg/hover-preview-setting.ts";
import { canStartModel, plainFailure } from "../aiseg/plain-message.ts";
import type { OutlineTier } from "../aiseg/prompt-fallback.ts";
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
import type { BestFallback, EncoderSource } from "../aiseg/view-embeddings.ts";
import { fingerPans } from "../devices/pen-touch.ts";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import { ContextExtra, contextChip } from "./context-extras.tsx";
import type { AnnotationDocument } from "./document.ts";
import { useElapsedSeconds } from "./elapsed-seconds.ts";
import { ModelTierChoice } from "./model-tier-choice.tsx";
import { type SmartStep, smartStatusOf, smartStepOf } from "./smart-status.ts";
import {
  bindSpacePan,
  buttonReleased,
  capturePointer,
  interruptMotion,
  keepCapture,
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
  tier?: OutlineTier;
  onTierChange?: (tier: OutlineTier) => void;
  queueControl?: RefObject<SmartQueueControl | null>;
  onDocumentChange: (next: AnnotationDocument) => void;
};

export type SmartQueueControl = { readonly count: () => number; readonly pop: () => void };

type EarlyPress = { readonly request: SmartPress };

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

const idle: SmartSnapshot = {
  kept: [],
  live: null,
  phase: "idle",
  message: null,
  queued: [],
  requests: 0,
};

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
  tier = "good",
  onTierChange,
  queueControl,
  onDocumentChange,
}: SmartLayerProps) {
  const { t } = useLingui();
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const [snapshot, setSnapshot] = useState<SmartSnapshot>(idle);
  const [press, setPress] = useState<Press | null>(null);
  const [hoverRing, setHoverRing] = useState<Float32Array | null>(null);
  const [encoderSource, setEncoderSource] = useState<EncoderSource | null>(null);
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
  const ready = useRef(false);
  const earlyRef = useRef<readonly EarlyPress[]>([]);
  const [early, setEarly] = useState<readonly SmartPress[]>([]);
  const writeEarly = useCallback((next: readonly EarlyPress[]) => {
    earlyRef.current = next;
    setEarly(next.map((item) => item.request));
  }, []);

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
        slideId,
        tier,
        open: latest.current.openRequest,
      };
      const loading = latest.current.loader(context);
      services.current = loading;
      setEncoderSource(null);
      void loading.then(
        (loaded) =>
          loaded.encoderSource?.subscribe((source) => {
            if (services.current === loading) setEncoderSource(source);
          }),
        () => undefined,
      );
      const created = services.current.then((loaded) =>
        createSmartSession({
          slideId,
          reader: loaded.reader,
          sam: loaded.sam,
          onChange: show,
          onHover: setHoverRing,
        }),
      );
      session.current = created;
      ready.current = false;
      void created.then(
        () => {
          if (session.current === created) ready.current = true;
        },
        () => undefined,
      );
      created.catch((error: unknown) => {
        writeEarly([]);
        show({
          ...idle,
          phase: "failed",
          message: plainFailure(error, "Smart select could not start"),
        });
      });
    }
    return session.current;
  }, [slideId, tier, show, writeEarly]);

  const startModel = useCallback(() => {
    const pending = session.current;
    const loaded = services.current;
    session.current = null;
    services.current = null;
    ready.current = false;
    writeEarly([]);
    void pending?.then(
      (value) => value.close(),
      () => undefined,
    );
    void loaded?.then(
      (value) => value.close(),
      () => undefined,
    );
    show(idle);
    const centre = screenToSlide(camera, rect, rect.width / 2, rect.height / 2);
    void sessionPromise().then((value) => value.prewarm(centre));
  }, [camera, rect, sessionPromise, show, writeEarly]);

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

  const loadedTier = useRef(tier);
  useEffect(() => {
    if (loadedTier.current === tier) return;
    loadedTier.current = tier;
    if (session.current !== null) startModel();
  }, [tier, startModel]);

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
    const submit = (request: SmartPress) => {
      const loading = sessionPromise();
      if (ready.current) {
        void loading.then((value) => value.press(request));
        return;
      }
      const item: EarlyPress = { request };
      writeEarly([...earlyRef.current, item]);
      void loading.then((value) => {
        if (!earlyRef.current.includes(item)) return;
        writeEarly(earlyRef.current.filter((each) => each !== item));
        return value.press(request);
      });
    };
    const pan = bindSpacePan(stage, {
      engine: () => latest.current.engine,
      gesturing: () => current !== null,
    });
    const down = (event: PointerEvent) => {
      if (
        fingerPans(event) ||
        (event.button !== 0 && event.button !== 2) ||
        current !== null ||
        pan.held()
      )
        return;
      event.stopImmediatePropagation();
      event.preventDefault();
      interruptMotion(latest.current.engine);
      capturePointer(stage, event.pointerId);
      void session.current?.then((value) => value.clearHover());
      current = {
        id: event.pointerId,
        button: isTwoFingerClick(event) ? secondaryButton : event.button,
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
      if (buttonReleased(event)) {
        up(event);
        return;
      }
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
      submit(request);
    };
    const leave = () => void session.current?.then((value) => value.clearHover());
    const cancel = (event: PointerEvent) => {
      if (current === null || event.pointerId !== current.id) return;
      current = null;
      pan.release();
      setPress(null);
    };
    const lost = keepCapture(stage, (id) => current?.id === id, cancel);
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
      if (earlyRef.current.length > 0) writeEarly(earlyRef.current.slice(0, -1));
      else send((value) => value.removeLast());
    };
    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    stage.addEventListener("pointerleave", leave, true);
    stage.addEventListener("pointercancel", cancel, true);
    stage.addEventListener("lostpointercapture", lost, true);
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
      stage.removeEventListener("lostpointercapture", lost, true);
      stage.removeEventListener("contextmenu", menu, true);
      stage.removeEventListener("dblclick", doubleClick, true);
      window.removeEventListener("keydown", key);
      pan.dispose();
      leaveRung?.();
    };
  }, [active, stage, escRegistry, sessionPromise, writeEarly]);

  useEffect(() => {
    if (!active) return;
    const count = () => earlyRef.current.length + shown.current.queued.length;
    const clear = () => {
      writeEarly([]);
      void session.current?.then((value) => value.clearQueue());
    };
    const control: SmartQueueControl = {
      count,
      pop: () => {
        if (earlyRef.current.length > 0) writeEarly(earlyRef.current.slice(0, -1));
        else void session.current?.then((value) => value.removeLast());
      },
    };
    if (queueControl) queueControl.current = control;
    const leaveRung = escRegistry?.add("draft", { open: () => count() > 0, peel: clear });
    return () => {
      if (queueControl?.current === control) queueControl.current = null;
      leaveRung?.();
    };
  }, [active, escRegistry, queueControl, writeEarly]);

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
  const queued = [...early, ...snapshot.queued];
  const queuedCount = queued.length;
  const queuedMarker = (press: SmartPress, index: number) => {
    const order = index + 1;
    const colour = press.kind === "point" && !press.positive ? negativeColour : positiveColour;
    if (press.kind === "box") {
      const corners = { a: where(press.from), b: where(press.to) };
      const edge = frame(corners);
      return (
        <g key={index} data-testid="smart-queued" data-order={order} data-kind="box">
          <rect
            {...edge}
            fill="none"
            stroke={colour}
            strokeWidth={2}
            strokeDasharray="4 3"
            opacity={0.8}
          />
          <circle cx={edge.x} cy={edge.y} r={8} fill="#fff" stroke={colour} strokeWidth={1.5} />
          <text
            x={edge.x}
            y={edge.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fontWeight={600}
            fill={colour}
          >
            {order}
          </text>
        </g>
      );
    }
    const at = where(press.at);
    return (
      <g
        key={index}
        data-testid="smart-queued"
        data-order={order}
        data-kind={press.positive ? "positive" : "negative"}
      >
        <circle
          cx={at.x}
          cy={at.y}
          r={9}
          fill="#fff"
          fillOpacity={0.85}
          stroke={colour}
          strokeWidth={1.5}
          strokeDasharray="3 2"
        />
        <text
          x={at.x}
          y={at.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={10}
          fontWeight={600}
          fill={colour}
        >
          {order}
        </text>
      </g>
    );
  };
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

  const status = smartStatusOf(snapshot);
  const step = smartStepOf(tier === "best" ? encoderSource : null);
  const seconds = useElapsedSeconds(status === "outlining" ? step : null);
  const fallback =
    encoderSource === null ||
    encoderSource === "asking" ||
    encoderSource === "preparing" ||
    encoderSource === "server"
      ? null
      : encoderSource;
  const stepText: Record<SmartStep, string> = {
    "asking-best": t`Asking Best's GPU`,
    "loading-model": t`Fetching Best's outline model`,
    outlining: t`Outlining`,
  };
  const statusWords =
    status === "outlining"
      ? seconds > 0
        ? t`${stepText[step]}, ${seconds} s`
        : stepText[step]
      : status === "found"
        ? t`Outline found`
        : status === "message"
          ? snapshot.message
          : null;
  const statusText = [statusWords, queuedCount > 0 ? t`${queuedCount} queued` : null]
    .filter((part) => part !== null)
    .join(", ");
  const fallbackText: Record<BestFallback, string> = {
    unsendable: t`Best cannot outline this view, Good outlined it`,
    refused: t`The server refused Best here, Good outlined this view`,
    offline: t`Best's GPU is not answering, Good outlined this view. Click again to ask Best again`,
    "gave-up": t`No GPU answered Best in 90 seconds, Good outlined this view. Click again to ask Best again`,
    cancelled: t`You stopped waiting for Best, Good outlined this view. Click again to ask Best again`,
  };

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
        data-queued={queuedCount}
        data-requests={snapshot.requests}
        data-hover={hoverRing === null ? 0 : 1}
        data-encoder={encoderSource ?? undefined}
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
        {active ? queued.map(queuedMarker) : null}
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
      {active && onTierChange ? <ModelTierChoice tier={tier} onTierChange={onTierChange} /> : null}
      {active ? (
        <ContextExtra>
          <button
            type="button"
            data-testid="smart-hover-toggle"
            aria-pressed={hoverOn}
            onClick={() => setHoverOn(!hoverOn)}
            className={`${contextChip} cursor-pointer aria-pressed:border-accent`}
          >
            {hoverOn ? t`Hover preview on` : t`Hover preview off`}
          </button>
          {tier === "best" && fallback !== null ? (
            <span
              data-testid="smart-encoder-fallback"
              data-reason={fallback}
              role="status"
              className={contextChip}
            >
              {fallbackText[fallback]}
            </span>
          ) : null}
          {status !== null || queuedCount > 0 ? (
            <span
              data-testid="smart-status"
              data-status={status ?? "queued"}
              data-step={status === "outlining" ? step : undefined}
              data-queued={queuedCount}
              role="status"
              className={contextChip}
            >
              {statusText}
              {canStartModel(snapshot.message) ? (
                <button
                  type="button"
                  data-testid="smart-start-model"
                  onClick={startModel}
                  className="ml-2 cursor-pointer text-accent underline"
                >
                  {t`Start the model`}
                </button>
              ) : null}
            </span>
          ) : null}
        </ContextExtra>
      ) : null}
    </>
  );
}
