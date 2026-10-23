import {
  type Camera,
  clampCamera,
  clampZoom,
  type SlidePoint,
  sameCamera,
  screenScale,
  type Viewport,
  type ZoomLimits,
} from "./camera.ts";
import { easeInOutCubic, type Flight, planFlight } from "./flight.ts";
import {
  coastStep,
  coastStopSpeed,
  easeZoomStep,
  keepRecentSamples,
  type PointerSample,
  releaseVelocity,
  type ScreenVelocity,
  speed,
} from "./physics.ts";

export type CameraMotion = "idle" | "dragging" | "coasting" | "zooming" | "flying";

export type FlightEnd = "arrived" | "cancelled";

export interface ScreenOffset {
  readonly x: number;
  readonly y: number;
}

export interface ZoomOptions {
  readonly animate?: boolean;
}

export interface CameraControllerHost {
  readonly limits: ZoomLimits;
  readonly now: () => number;
  readonly getCamera: () => Camera;
  readonly applyCamera: (camera: Camera) => void;
  readonly viewport: () => Viewport | null;
  readonly requestFrame: () => void;
  readonly animates: () => boolean;
}

export interface CameraController {
  readonly motion: () => CameraMotion;
  readonly step: () => boolean;
  readonly interrupt: () => void;
  readonly cancel: () => void;
  readonly settle: () => void;
  readonly panBy: (dx: number, dy: number) => void;
  readonly zoomTo: (zoom: number, anchor?: ScreenOffset, options?: ZoomOptions) => void;
  readonly zoomBy: (octaves: number, anchor?: ScreenOffset, options?: ZoomOptions) => void;
  readonly startDrag: (x: number, y: number) => void;
  readonly dragTo: (x: number, y: number) => void;
  readonly endDrag: () => void;
  readonly flyTo: (target: Camera) => Promise<FlightEnd>;
}

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "dragging"; samples: readonly PointerSample[] }
  | { readonly kind: "coasting"; velocity: ScreenVelocity; time: number }
  | {
      readonly kind: "zooming";
      readonly target: number;
      readonly anchor: ScreenOffset;
      readonly point: SlidePoint;
      time: number;
    }
  | {
      readonly kind: "flying";
      readonly flight: Flight;
      readonly start: number;
      readonly finish: (end: FlightEnd) => void;
    };

const idle: State = { kind: "idle" };
const viewportCentre: ScreenOffset = { x: 0, y: 0 };

function pointUnder(camera: Camera, anchor: ScreenOffset): SlidePoint {
  const scale = screenScale(camera);
  return { x: camera.x + anchor.x / scale, y: camera.y + anchor.y / scale };
}

function zoomAbout(zoom: number, anchor: ScreenOffset, point: SlidePoint): Camera {
  const scale = 2 ** zoom;
  return { x: point.x - anchor.x / scale, y: point.y - anchor.y / scale, zoom };
}

export function createCameraController(host: CameraControllerHost): CameraController {
  let state: State = idle;

  const moveBy = (dx: number, dy: number) => {
    const camera = host.getCamera();
    const scale = screenScale(camera);
    host.applyCamera({ x: camera.x - dx / scale, y: camera.y - dy / scale, zoom: camera.zoom });
  };

  const stop = (end: FlightEnd) => {
    const current = state;
    state = idle;
    if (current.kind === "flying") current.finish(end);
  };

  const cancel = () => stop("cancelled");

  const interrupt = () => {
    if (state.kind === "flying" || state.kind === "coasting") cancel();
  };

  const settle = () => {
    const current = state;
    if (current.kind === "flying") host.applyCamera(current.flight.to);
    if (current.kind === "zooming") {
      host.applyCamera(zoomAbout(current.target, current.anchor, current.point));
    }
    stop("arrived");
  };

  const begin = (next: State) => {
    state = next;
    host.requestFrame();
  };

  const stepZoom = (current: Extract<State, { kind: "zooming" }>, now: number): boolean => {
    const zoom = easeZoomStep(host.getCamera().zoom, current.target, now - current.time);
    current.time = now;
    host.applyCamera(zoomAbout(zoom, current.anchor, current.point));
    if (zoom !== current.target) return true;
    state = idle;
    return false;
  };

  const stepCoast = (current: Extract<State, { kind: "coasting" }>, now: number): boolean => {
    const next = coastStep(current.velocity, now - current.time);
    current.time = now;
    current.velocity = next.velocity;
    moveBy(next.dx, next.dy);
    if (speed(next.velocity) >= coastStopSpeed) return true;
    state = idle;
    return false;
  };

  const stepFlight = (current: Extract<State, { kind: "flying" }>, now: number): boolean => {
    const progress = (now - current.start) / current.flight.durationMs;
    host.applyCamera(current.flight.at(easeInOutCubic(progress)));
    if (progress < 1) return true;
    stop("arrived");
    return false;
  };

  const step = (): boolean => {
    const current = state;
    const now = host.now();
    switch (current.kind) {
      case "zooming":
        return stepZoom(current, now);
      case "coasting":
        return stepCoast(current, now);
      case "flying":
        return stepFlight(current, now);
      case "dragging":
      case "idle":
        return false;
    }
  };

  const zoomTo = (zoom: number, anchor = viewportCentre, options: ZoomOptions = {}) => {
    cancel();
    const target = clampZoom(zoom, host.limits);
    const point = pointUnder(host.getCamera(), anchor);
    if (options.animate === false || !host.animates()) {
      host.applyCamera(zoomAbout(target, anchor, point));
      return;
    }
    begin({ kind: "zooming", target, anchor, point, time: host.now() });
  };

  const zoomBy = (octaves: number, anchor = viewportCentre, options: ZoomOptions = {}) => {
    const base = state.kind === "zooming" ? state.target : host.getCamera().zoom;
    zoomTo(base + octaves, anchor, options);
  };

  const panBy = (dx: number, dy: number) => {
    cancel();
    moveBy(dx, dy);
  };

  const startDrag = (x: number, y: number) => {
    cancel();
    state = { kind: "dragging", samples: [{ x, y, time: host.now() }] };
  };

  const dragTo = (x: number, y: number) => {
    if (state.kind !== "dragging") return;
    const last = state.samples.at(-1);
    const time = host.now();
    if (last) moveBy(x - last.x, y - last.y);
    state.samples = keepRecentSamples([...state.samples, { x, y, time }], time);
  };

  const endDrag = () => {
    if (state.kind !== "dragging") return;
    const now = host.now();
    const velocity = releaseVelocity(state.samples, now);
    state = idle;
    if (velocity && host.animates()) begin({ kind: "coasting", velocity, time: now });
  };

  const flyTo = (target: Camera): Promise<FlightEnd> => {
    cancel();
    const to = clampCamera(target, host.limits);
    const from = host.getCamera();
    const viewport = host.viewport();
    if (sameCamera(from, to)) return Promise.resolve("arrived");
    if (!host.animates() || !viewport || viewport.width <= 0) {
      host.applyCamera(to);
      return Promise.resolve("arrived");
    }
    const flight = planFlight(from, to, viewport.width);
    return new Promise((resolve) => {
      begin({ kind: "flying", flight, start: host.now(), finish: resolve });
    });
  };

  return {
    motion: () => state.kind,
    step,
    interrupt,
    cancel,
    settle,
    panBy,
    zoomTo,
    zoomBy,
    startDrag,
    dragTo,
    endDrag,
    flyTo,
  };
}
