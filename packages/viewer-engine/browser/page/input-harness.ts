import {
  bindViewerInput,
  type Camera,
  type CameraMotion,
  createViewerEngine,
  type EngineSlide,
  type FrameScheduler,
  fitCamera,
  type RendererRoute,
  type ScreenRect,
  type ViewerEngine,
  type ViewerInputBinding,
  type WheelMode,
} from "../../src/index.ts";

export interface InputSetup {
  readonly primaryDragPans: boolean;
  readonly captureFails: boolean;
  readonly wheelMode: WheelMode;
  readonly camera: Camera;
}

export interface RecordedFrame {
  readonly time: number;
  readonly camera: Camera;
  readonly motion: CameraMotion;
}

export interface ViewerStyle {
  readonly touchAction: string;
  readonly userSelect: string;
  readonly cursor: string;
  readonly overscroll: string;
}

export interface InputHarness {
  setup(options: InputSetup): Promise<void>;
  camera(): Camera;
  motion(): CameraMotion;
  gesture(): string;
  rect(): ScreenRect;
  style(): ViewerStyle;
  startRecording(): void;
  stopRecording(): readonly RecordedFrame[];
  engineFrames(): number;
  releaseCapture(): boolean;
  hasCapture(): boolean;
  fitReference(): Camera;
  doubleClickEvents(): number;
  touchPointerDowns(): number;
  blurWindow(): void;
  whenIdle(timeoutMs: number): Promise<void>;
}

declare global {
  interface Window {
    inputHarness: InputHarness;
  }
}

const slide: EngineSlide = {
  id: "input-harness",
  width: 80_000,
  height: 60_000,
  micronsPerPixel: 0.25,
  close: () => {},
};

const stillRoute: RendererRoute = {
  showSlide: () => {},
  setCamera: () => {},
  setOverlays: () => {},
  invalidateOverlay: () => {},
  destroy: () => {},
};

let engine: ViewerEngine | null = null;
let binding: ViewerInputBinding | null = null;
let engineFrameCount = 0;
let recording: RecordedFrame[] | null = null;
let activePointer: number | null = null;
let spaceHeld = false;
let doubleClickEvents = 0;
let touchPointerDowns = 0;

const countedFrames: FrameScheduler = {
  request: (callback) =>
    requestAnimationFrame(() => {
      engineFrameCount += 1;
      callback();
    }),
  cancel: (handle) => cancelAnimationFrame(handle),
};

function viewer(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The input page has no #viewer element");
  return element;
}

function current(): ViewerEngine {
  if (engine === null) throw new Error("Call setup first");
  return engine;
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

globalThis.addEventListener("keydown", (event) => {
  if (event.code === "Space") spaceHeld = true;
});
globalThis.addEventListener("keyup", (event) => {
  if (event.code === "Space") spaceHeld = false;
});
globalThis.addEventListener("blur", () => {
  spaceHeld = false;
});
viewer().addEventListener("dblclick", () => {
  doubleClickEvents += 1;
});
viewer().addEventListener("pointerdown", (event) => {
  if (event.pointerType === "touch") touchPointerDowns += 1;
  activePointer = event.pointerId;
});

async function setup(options: InputSetup): Promise<void> {
  binding?.dispose();
  engine?.dispose();
  const element = viewer();
  Reflect.deleteProperty(element, "setPointerCapture");
  if (options.captureFails) {
    element.setPointerCapture = () => {
      throw new DOMException("Capture refused by the harness", "NotFoundError");
    };
  }
  const next = createViewerEngine({
    createRenderer: () => stillRoute,
    openSlide: () => Promise.resolve(slide),
    frames: countedFrames,
    reducedMotion: () => false,
  });
  engine = next;
  next.mount(element);
  await next.openSlide({ id: slide.id });
  next.setCamera(options.camera);
  binding = bindViewerInput(element, next, {
    wheelMode: options.wheelMode,
    primaryDragPans: () => options.primaryDragPans,
    panModifierHeld: () => spaceHeld,
  });
  await whenIdle(2000);
}

function record() {
  if (recording === null) return;
  recording.push({
    time: performance.now(),
    camera: current().getCamera(),
    motion: current().getMotion(),
  });
  requestAnimationFrame(record);
}

async function whenIdle(timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  let calm = 0;
  while (calm < 3) {
    if (performance.now() > deadline) throw new Error("The camera did not come to rest");
    const before = engineFrameCount;
    await nextFrame();
    calm = current().getMotion() === "idle" && engineFrameCount === before ? calm + 1 : 0;
  }
}

window.inputHarness = {
  setup,
  camera: () => current().getCamera(),
  motion: () => current().getMotion(),
  gesture: () => binding?.gesture() ?? "none",
  rect: () => {
    const box = viewer().getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  },
  style: () => ({
    touchAction: viewer().style.touchAction,
    userSelect: viewer().style.userSelect,
    cursor: viewer().style.cursor,
    overscroll: document.documentElement.style.overscrollBehavior,
  }),
  startRecording: () => {
    recording = [];
    requestAnimationFrame(record);
  },
  stopRecording: () => {
    const frames = recording ?? [];
    recording = null;
    return frames;
  },
  engineFrames: () => engineFrameCount,
  releaseCapture: () => {
    if (activePointer === null || !viewer().hasPointerCapture(activePointer)) return false;
    viewer().releasePointerCapture(activePointer);
    return true;
  },
  hasCapture: () => activePointer !== null && viewer().hasPointerCapture(activePointer),
  fitReference: () => {
    const box = viewer().getBoundingClientRect();
    return fitCamera(
      slide,
      { width: box.width, height: box.height },
      current().getCameraBounds(),
      slide.tissue,
    );
  },
  doubleClickEvents: () => doubleClickEvents,
  touchPointerDowns: () => touchPointerDowns,
  blurWindow: () => {
    globalThis.dispatchEvent(new FocusEvent("blur"));
  },
  whenIdle,
};
