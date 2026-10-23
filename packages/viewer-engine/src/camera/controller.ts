import {
  type Camera,
  type CameraBounds,
  clampCamera,
  clampZoom,
  type SlidePoint,
  sameCamera,
  screenScale,
  type Viewport,
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
import {
  type CameraProfile,
  coasts,
  defaultCameraProfile,
  easesZoom,
  flies,
  withoutMotion,
} from "./profile.ts";

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
  readonly bounds: () => CameraBounds;
  readonly now: () => number;
  readonly getCamera: () => Camera;
  readonly applyCamera: (camera: Camera) => void;
  readonly viewport: () => Viewport | null;
  readonly requestFrame: () => void;
  readonly animates: () => boolean;
  readonly profile?: CameraProfile;
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
  readonly dragTo: (x: number, y: number, time?: number) => void;
  readonly endDrag: () => void;
  readonly flyTo: (target: Camera) => Promise<FlightEnd>;
  readonly profile: () => CameraProfile;
  readonly setProfile: (profile: CameraProfile) => void;
}

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "dragging"; samples: readonly PointerSample[] }
  | { readonly kind: "coasting"; velocity: ScreenVelocity; time: number; until: number }
  | {
      readonly kind: "zooming";
      readonly target: number;
      readonly anchor: ScreenOffset;
      readonly point: SlidePoint;
      zoom: number;
      time: number;
    }
  | {
      readonly kind: "flying";
      readonly flight: Flight;
      readonly start: number;
      readonly finish: (end: FlightEnd) => void;
    };

interface Walls {
  readonly x: boolean;
  readonly y: boolean;
}

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

function sameOffset(a: ScreenOffset, b: ScreenOffset): boolean {
  return a.x === b.x && a.y === b.y;
}

function coastEnd(velocity: ScreenVelocity, start: number, decayMs: number): number {
  const ratio = speed(velocity) / coastStopSpeed;
  return ratio > 1 ? start + decayMs * Math.log(ratio) : start;
}

function awayFromWalls(
  velocity: ScreenVelocity,
  camera: Camera,
  bounds: CameraBounds,
): ScreenVelocity | null {
  const extent = bounds.extent;
  if (!extent) return velocity;
  const pressed = (position: number, end: number, push: number) =>
    (position <= 0 && push > 0) || (position >= end && push < 0);
  const free = {
    x: pressed(camera.x, extent.width, velocity.x) ? 0 : velocity.x,
    y: pressed(camera.y, extent.height, velocity.y) ? 0 : velocity.y,
  };
  return speed(free) > 0 ? free : null;
}

function finite(...values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function animatedUnder(state: State, feel: CameraProfile): boolean {
  switch (state.kind) {
    case "coasting":
      return coasts(feel);
    case "zooming":
      return easesZoom(feel);
    case "flying":
      return flies(feel);
    case "dragging":
    case "idle":
      return true;
  }
}

export function createCameraController(host: CameraControllerHost): CameraController {
  let state: State = idle;
  let chosen = host.profile ?? defaultCameraProfile;

  const feel = (): CameraProfile => (host.animates() ? chosen : withoutMotion(chosen));

  const moveBy = (dx: number, dy: number): Walls => {
    const camera = host.getCamera();
    const scale = screenScale(camera);
    const intended = { x: camera.x - dx / scale, y: camera.y - dy / scale, zoom: camera.zoom };
    host.applyCamera(intended);
    const applied = host.getCamera();
    return { x: applied.x !== intended.x, y: applied.y !== intended.y };
  };

  const stop = (end: FlightEnd) => {
    const current = state;
    state = idle;
    if (current.kind === "flying") current.finish(end);
  };

  const stopUnanimated = (): boolean => {
    if (animatedUnder(state, feel())) return false;
    stop("cancelled");
    return true;
  };

  const stepZoom = (current: Extract<State, { kind: "zooming" }>, now: number): boolean => {
    const zoom = easeZoomStep(current.zoom, current.target, now - current.time, chosen.zoomEaseMs);
    current.zoom = zoom;
    current.time = now;
    host.applyCamera(zoomAbout(zoom, current.anchor, current.point));
    if (zoom !== current.target && host.getCamera().zoom === zoom) return true;
    state = idle;
    return false;
  };

  const stepCoast = (current: Extract<State, { kind: "coasting" }>, now: number): boolean => {
    const end = Math.min(now, current.until);
    const next = coastStep(current.velocity, end - current.time, chosen.coastDecayMs);
    current.time = end;
    const walls = moveBy(next.dx, next.dy);
    current.velocity = {
      x: walls.x ? 0 : next.velocity.x,
      y: walls.y ? 0 : next.velocity.y,
    };
    if (end < current.until && speed(current.velocity) > 0) return true;
    state = idle;
    return false;
  };

  const stepFlight = (current: Extract<State, { kind: "flying" }>, now: number): boolean => {
    const progress = (now - current.start) / current.flight.durationMs;
    const camera = current.flight.at(easeInOutCubic(progress));
    host.applyCamera(camera);
    if (progress < 1 && !sameCamera(camera, current.flight.to)) return true;
    stop("arrived");
    return false;
  };

  const step = (): boolean => {
    if (stopUnanimated()) return false;
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

  const catchUp = () => {
    if (state.kind !== "idle" && state.kind !== "dragging") step();
  };

  const cancel = () => {
    catchUp();
    stop("cancelled");
  };

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

  const zoomTo = (zoom: number, anchor = viewportCentre, options: ZoomOptions = {}) => {
    if (!finite(zoom, anchor.x, anchor.y)) return;
    catchUp();
    const current = state;
    const profile = feel();
    const at = profile.zoomAnchor === "centre" ? viewportCentre : anchor;
    const camera = host.getCamera();
    const continuing = current.kind === "zooming" && sameOffset(current.anchor, at);
    const point = continuing ? current.point : pointUnder(camera, at);
    const from = continuing ? current.zoom : camera.zoom;
    stop("cancelled");
    const target = clampZoom(zoom, host.bounds());
    if (options.animate === false || !easesZoom(profile)) {
      host.applyCamera(zoomAbout(target, at, point));
      return;
    }
    if (target === from) return;
    begin({ kind: "zooming", target, anchor: at, point, zoom: from, time: host.now() });
  };

  const zoomBy = (octaves: number, anchor = viewportCentre, options: ZoomOptions = {}) => {
    if (!Number.isFinite(octaves)) return;
    const base = state.kind === "zooming" ? state.target : host.getCamera().zoom;
    zoomTo(base + octaves, anchor, options);
  };

  const panBy = (dx: number, dy: number) => {
    if (!finite(dx, dy)) return;
    cancel();
    moveBy(dx, dy);
  };

  const startDrag = (x: number, y: number) => {
    if (!finite(x, y)) return;
    cancel();
    state = { kind: "dragging", samples: [{ x, y, time: host.now() }] };
  };

  const dragTo = (x: number, y: number, time = host.now()) => {
    if (state.kind !== "dragging" || !finite(x, y)) return;
    const last = state.samples.at(-1);
    if (last) moveBy(x - last.x, y - last.y);
    state.samples = keepRecentSamples(
      [...state.samples, { x, y, time }],
      time,
      chosen.velocityWindowMs,
    );
  };

  const endDrag = () => {
    if (state.kind !== "dragging") return;
    const now = host.now();
    const profile = feel();
    const thrown = releaseVelocity(state.samples, now, profile);
    const velocity = thrown && awayFromWalls(thrown, host.getCamera(), host.bounds());
    state = idle;
    if (velocity && coasts(profile)) {
      begin({
        kind: "coasting",
        velocity,
        time: now,
        until: coastEnd(velocity, now, profile.coastDecayMs),
      });
    }
  };

  const flyTo = (target: Camera): Promise<FlightEnd> => {
    if (!finite(target.x, target.y, target.zoom)) {
      return Promise.reject(new RangeError("A flight needs a finite target"));
    }
    cancel();
    const profile = feel();
    const to = clampCamera(target, host.bounds());
    const from = host.getCamera();
    const viewport = host.viewport();
    if (sameCamera(from, to)) return Promise.resolve("arrived");
    const flight =
      flies(profile) && viewport && viewport.width > 0
        ? planFlight(from, to, viewport.width, profile)
        : null;
    if (!flight || !(flight.durationMs > 0)) {
      host.applyCamera(to);
      return Promise.resolve("arrived");
    }
    return new Promise((resolve) => {
      begin({ kind: "flying", flight, start: host.now(), finish: resolve });
    });
  };

  const setProfile = (profile: CameraProfile) => {
    catchUp();
    chosen = profile;
    if (stopUnanimated()) return;
    if (state.kind === "coasting") {
      state.until = coastEnd(state.velocity, state.time, chosen.coastDecayMs);
    }
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
    profile: () => chosen,
    setProfile,
  };
}
