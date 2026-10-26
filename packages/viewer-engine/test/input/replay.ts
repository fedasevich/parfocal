import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Camera,
  type CameraController,
  clampCamera,
  createCameraController,
  createGestureInterpreter,
  type GestureHooks,
  type GestureInterpreter,
  type InputAction,
  type InputPoint,
  type ScreenOffset,
  type ViewerInput,
  type WheelMode,
  type ZoomLimits,
} from "../../src/index.ts";
import type { InputTrace, TraceEvent } from "./trace-format.ts";

export const tracesDir = fileURLToPath(new URL("./traces", import.meta.url));

export interface TraceFile {
  readonly file: string;
  readonly trace: InputTrace;
}

export function loadTraces(dir = tracesDir): readonly TraceFile[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({
      file,
      trace: JSON.parse(readFileSync(join(dir, file), "utf8")) as InputTrace,
    }));
}

export function traceInput(event: TraceEvent): ViewerInput {
  const modifiers = {
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  };
  const at = { clientX: event.clientX, clientY: event.clientY };
  switch (event.type) {
    case "wheel":
      return {
        kind: "wheel",
        ...at,
        ...modifiers,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
      };
    case "dblclick":
      return { kind: "dblclick", ...at, ...modifiers, button: event.button };
    case "pointerdown":
    case "pointermove":
    case "pointerup":
    case "pointercancel":
      return {
        kind: (
          {
            pointerdown: "down",
            pointermove: "move",
            pointerup: "up",
            pointercancel: "cancel",
          } as const
        )[event.type],
        ...at,
        ...modifiers,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        button: event.button,
        buttons: event.buttons,
      };
  }
}

export interface ReplayStep {
  readonly input: ViewerInput;
  readonly actions: readonly InputAction[];
  readonly before: Camera;
  readonly after: Camera;
}

export interface ReplayViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export const replayLimits: ZoomLimits = { minZoom: -12, maxZoom: 6 };
export const frameMs = 1000 / 60;

export interface ReplayRig {
  readonly interpreter: GestureInterpreter;
  readonly controller: CameraController;
  readonly camera: () => Camera;
  readonly frames: () => readonly Camera[];
  readonly feed: (input: ViewerInput, at?: number) => ReplayStep;
  readonly advanceTo: (time: number) => void;
  readonly settle: () => number;
  readonly time: () => number;
  readonly screenOf: (camera: Camera, point: { x: number; y: number }) => InputPoint;
  readonly slideAt: (camera: Camera, at: InputPoint) => { x: number; y: number };
}

export function createReplayRig(
  viewport: ReplayViewport,
  mode: WheelMode = "auto",
  hooks: GestureHooks = {},
  start: Camera = { x: 20_000, y: 15_000, zoom: -2 },
): ReplayRig {
  let clock = 0;
  let camera = start;
  let pending = false;
  const frames: Camera[] = [];
  const controller = createCameraController({
    bounds: () => replayLimits,
    now: () => clock,
    getCamera: () => camera,
    applyCamera: (next) => {
      camera = clampCamera(next, replayLimits);
    },
    viewport: () => viewport,
    requestFrame: () => {
      pending = true;
    },
    animates: () => true,
  });
  const interpreter = createGestureInterpreter(hooks, mode);

  const offset = (at: InputPoint): ScreenOffset => ({
    x: at.clientX - viewport.left - viewport.width / 2,
    y: at.clientY - viewport.top - viewport.height / 2,
  });

  const runFrame = () => {
    pending = false;
    if (controller.step()) pending = true;
    frames.push(camera);
  };

  const advanceTo = (time: number) => {
    while (pending && clock + frameMs <= time) {
      clock += frameMs;
      runFrame();
    }
    clock = Math.max(clock, time);
  };

  const apply = (action: InputAction) => {
    switch (action.kind) {
      case "startDrag":
        controller.startDrag(action.at.clientX, action.at.clientY);
        return;
      case "dragTo":
        controller.dragTo(action.at.clientX, action.at.clientY, clock - action.ageMs);
        return;
      case "endDrag":
        controller.endDrag();
        return;
      case "abandonDrag":
        controller.cancel();
        return;
      case "pan":
        controller.panBy(action.dx, action.dy);
        return;
      case "zoom":
        controller.zoomBy(action.octaves, offset(action.at), { animate: action.animate });
        return;
      case "magnify":
      case "fitSlide":
      case "capture":
      case "release":
      case "cursor":
      case "preventDefault":
        return;
    }
  };

  const feed = (input: ViewerInput, at = clock): ReplayStep => {
    advanceTo(at);
    const before = camera;
    if (input.kind === "down" || input.kind === "wheel") controller.interrupt();
    const actions = interpreter.handle(input);
    for (const action of actions) apply(action);
    return { input, actions, before, after: camera };
  };

  const settle = () => {
    let count = 0;
    while (pending) {
      if (count > 2000) throw new Error("The camera is still moving after 2000 frames");
      clock += frameMs;
      runFrame();
      count += 1;
    }
    return count;
  };

  const screenOf = (of: Camera, point: { x: number; y: number }): InputPoint => {
    const scale = 2 ** of.zoom;
    return {
      clientX: viewport.left + viewport.width / 2 + (point.x - of.x) * scale,
      clientY: viewport.top + viewport.height / 2 + (point.y - of.y) * scale,
    };
  };

  const slideAt = (of: Camera, at: InputPoint) => {
    const scale = 2 ** of.zoom;
    const local = offset(at);
    return { x: of.x + local.x / scale, y: of.y + local.y / scale };
  };

  return {
    interpreter,
    controller,
    camera: () => camera,
    frames: () => frames,
    feed,
    advanceTo,
    settle,
    time: () => clock,
    screenOf,
    slideAt,
  };
}
