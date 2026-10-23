import {
  type Camera,
  clampCamera,
  defaultZoomLimits,
  fitCamera,
  originCamera,
  type ScreenRect,
  sameCamera,
  screenToSlide,
} from "../camera/camera.ts";
import { animationFrames, observeElementResize } from "./environment.ts";
import type {
  EngineContainer,
  EngineEvents,
  EngineSlide,
  EngineStatus,
  OverlayLayer,
  OverlayRegistration,
  RendererRoute,
  SlideInfo,
  SlidePointerEvent,
  SlidePointerKind,
  SlideRef,
  Unsubscribe,
  ViewerEngine,
  ViewerEngineOptions,
} from "./types.ts";

const pointerEventKinds: ReadonlyArray<readonly [string, SlidePointerKind]> = [
  ["pointerdown", "down"],
  ["pointermove", "move"],
  ["pointerup", "up"],
  ["pointercancel", "cancel"],
  ["pointerleave", "leave"],
  ["wheel", "wheel"],
];

interface PointerLike {
  clientX?: number;
  clientY?: number;
  pointerId?: number;
  buttons?: number;
  deltaY?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

interface Mounted<Slide extends EngineSlide> {
  readonly container: EngineContainer;
  readonly route: RendererRoute<Slide>;
  readonly detach: readonly Unsubscribe[];
}

export class EngineDisposedError extends Error {
  constructor() {
    super("The viewer engine is disposed");
    this.name = "EngineDisposedError";
  }
}

export class SlideOpenSupersededError extends Error {
  constructor(id: string) {
    super(`Opening slide ${id} was superseded`);
    this.name = "SlideOpenSupersededError";
  }
}

function describe(slide: EngineSlide): SlideInfo {
  return {
    id: slide.id,
    width: slide.width,
    height: slide.height,
    micronsPerPixel: slide.micronsPerPixel,
  };
}

export function createViewerEngine<Slide extends EngineSlide>(
  options: ViewerEngineOptions<Slide>,
): ViewerEngine {
  const limits = options.zoomLimits ?? defaultZoomLimits;
  const frames = options.frames ?? animationFrames;
  const observeResize = options.observeResize ?? observeElementResize;

  let disposed = false;
  let mounted: Mounted<Slide> | null = null;
  let slide: Slide | null = null;
  let slideInfo: SlideInfo | null = null;
  let camera: Camera = clampCamera(originCamera, limits);
  let fitPending = false;
  let rect: ScreenRect | null = null;
  let frame: number | null = null;
  let cameraDirty = false;
  let pendingOpen: AbortController | null = null;

  const cameraListeners = new Set<() => void>();
  const eventListeners: { [Name in keyof EngineEvents]: Set<(event: EngineEvents[Name]) => void> } =
    { pointer: new Set(), slide: new Set() };
  const overlays = new Map<string, OverlayLayer>();

  const assertAlive = () => {
    if (disposed) throw new EngineDisposedError();
  };

  const notifyCamera = () => {
    cameraDirty = false;
    for (const listener of [...cameraListeners]) listener();
  };

  const runFrame = () => {
    frame = null;
    rect = null;
    if (cameraDirty) notifyCamera();
  };

  const requestFrame = () => {
    if (frame === null) frame = frames.request(runFrame);
  };

  const cancelFrame = () => {
    if (frame !== null) frames.cancel(frame);
    frame = null;
    rect = null;
  };

  const measure = (container: EngineContainer): ScreenRect => {
    if (rect === null) {
      rect = container.getBoundingClientRect();
      requestFrame();
    }
    return rect;
  };

  const emit = <Name extends keyof EngineEvents>(name: Name, event: EngineEvents[Name]) => {
    const listeners = eventListeners[name] as Set<(value: EngineEvents[Name]) => void>;
    for (const listener of [...listeners]) listener(event);
  };

  const applyCamera = (next: Camera) => {
    const clamped = clampCamera(next, limits);
    if (sameCamera(clamped, camera)) return;
    camera = clamped;
    mounted?.route.setCamera(camera);
    if (mounted) {
      cameraDirty = true;
      requestFrame();
    } else {
      notifyCamera();
    }
  };

  const fitIfPossible = () => {
    if (!slide) return;
    const viewport = mounted ? measure(mounted.container) : null;
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
      fitPending = true;
      applyCamera({ x: slide.width / 2, y: slide.height / 2, zoom: camera.zoom });
      return;
    }
    fitPending = false;
    applyCamera(fitCamera(slide, viewport, limits));
  };

  const sortedOverlays = (): readonly OverlayLayer[] =>
    [...overlays.values()].sort((a, b) => a.order - b.order);

  const pointerListener =
    (kind: SlidePointerKind, container: EngineContainer) => (source: Event) => {
      if (eventListeners.pointer.size === 0) return;
      const input = source as PointerLike;
      const clientX = input.clientX ?? 0;
      const clientY = input.clientY ?? 0;
      const point = screenToSlide(camera, measure(container), clientX, clientY);
      const event: SlidePointerEvent = {
        kind,
        slideX: point.x,
        slideY: point.y,
        clientX,
        clientY,
        pointerId: input.pointerId ?? 0,
        buttons: input.buttons ?? 0,
        deltaY: input.deltaY ?? 0,
        shiftKey: input.shiftKey ?? false,
        altKey: input.altKey ?? false,
        ctrlKey: input.ctrlKey ?? false,
        metaKey: input.metaKey ?? false,
        source,
      };
      emit("pointer", event);
    };

  const mount = (container: EngineContainer) => {
    assertAlive();
    if (mounted) throw new Error("The viewer engine is already mounted");
    const route = options.createRenderer(container);
    const detach: Unsubscribe[] = [];
    for (const [type, kind] of pointerEventKinds) {
      const listener = pointerListener(kind, container);
      container.addEventListener(type, listener);
      detach.push(() => container.removeEventListener(type, listener));
    }
    detach.push(
      observeResize(container, () => {
        rect = null;
        if (fitPending) fitIfPossible();
      }),
    );
    mounted = { container, route, detach };
    route.setOverlays(sortedOverlays());
    route.showSlide(slide);
    route.setCamera(camera);
    if (fitPending) fitIfPossible();
  };

  const unmount = () => {
    if (!mounted) return;
    const { route, detach } = mounted;
    mounted = null;
    for (const remove of detach) remove();
    cancelFrame();
    if (cameraDirty) notifyCamera();
    route.destroy();
  };

  const closeCurrentSlide = () => {
    const previous = slide;
    slide = null;
    slideInfo = null;
    fitPending = false;
    mounted?.route.showSlide(null);
    previous?.close();
  };

  const openSlide = async (ref: SlideRef): Promise<SlideInfo> => {
    assertAlive();
    pendingOpen?.abort();
    const controller = new AbortController();
    pendingOpen = controller;
    let opened: Slide;
    try {
      opened = await options.openSlide(ref, controller.signal);
    } catch (error) {
      if (pendingOpen === controller) pendingOpen = null;
      throw error;
    }
    if (disposed || pendingOpen !== controller) {
      opened.close();
      if (disposed) throw new EngineDisposedError();
      throw new SlideOpenSupersededError(ref.id);
    }
    pendingOpen = null;
    closeCurrentSlide();
    slide = opened;
    slideInfo = describe(opened);
    mounted?.route.showSlide(opened);
    fitIfPossible();
    emit("slide", slideInfo);
    return slideInfo;
  };

  const closeSlide = () => {
    assertAlive();
    pendingOpen?.abort();
    pendingOpen = null;
    if (!slide) return;
    closeCurrentSlide();
    emit("slide", null);
  };

  const registerOverlay = (layer: OverlayLayer): OverlayRegistration => {
    assertAlive();
    if (overlays.has(layer.id)) throw new Error(`Overlay ${layer.id} is already registered`);
    overlays.set(layer.id, layer);
    mounted?.route.setOverlays(sortedOverlays());
    let registered = true;
    return {
      invalidate: () => {
        if (registered) mounted?.route.invalidateOverlay(layer.id);
      },
      unregister: () => {
        if (!registered) return;
        registered = false;
        overlays.delete(layer.id);
        mounted?.route.setOverlays(sortedOverlays());
      },
    };
  };

  const dispose = () => {
    if (disposed) return;
    pendingOpen?.abort();
    pendingOpen = null;
    unmount();
    disposed = true;
    const last = slide;
    slide = null;
    slideInfo = null;
    last?.close();
    overlays.clear();
    cameraListeners.clear();
    eventListeners.pointer.clear();
    eventListeners.slide.clear();
  };

  const status = (): EngineStatus => {
    if (disposed) return "disposed";
    return mounted ? "mounted" : "detached";
  };

  return {
    status,
    mount,
    unmount,
    openSlide,
    closeSlide,
    getSlide: () => slideInfo,
    getCamera: () => camera,
    setCamera: (next) => {
      assertAlive();
      fitPending = false;
      applyCamera(next);
    },
    fitToSlide: () => {
      assertAlive();
      fitIfPossible();
    },
    subscribeCamera: (listener) => {
      assertAlive();
      cameraListeners.add(listener);
      return () => {
        cameraListeners.delete(listener);
      };
    },
    on: (name, listener) => {
      assertAlive();
      const listeners = eventListeners[name] as Set<typeof listener>;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    registerOverlay,
    dispose,
  };
}
