import {
  areaCamera,
  type Camera,
  type CameraBounds,
  cameraBounds,
  clampCamera,
  fitArea,
  fitCamera,
  originCamera,
  type ScreenRect,
  type SlideArea,
  sameCamera,
  screenToSlide,
} from "../camera/camera.ts";
import { createCameraController, type ScreenOffset } from "../camera/controller.ts";
import { zoomForMagnification } from "../camera/magnification.ts";
import {
  animationFrames,
  observeElementResize,
  prefersReducedMotion,
  screenPixelRatio,
  systemClock,
} from "./environment.ts";
import type {
  ClientPoint,
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
  const frames = options.frames ?? animationFrames;
  const observeResize = options.observeResize ?? observeElementResize;
  const now = options.now ?? systemClock;
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion;
  const devicePixelRatio = options.devicePixelRatio ?? screenPixelRatio;

  let disposed = false;
  let mounted: Mounted<Slide> | null = null;
  let slide: Slide | null = null;
  let slideInfo: SlideInfo | null = null;
  let bounds: CameraBounds | null = null;
  let fitPending = false;
  let rect: ScreenRect | null = null;
  let frame: number | null = null;
  let inFrame = false;
  let cameraDirty = false;
  let pendingOpen: AbortController | null = null;

  const cameraListeners = new Set<() => void>();
  const eventListeners: { [Name in keyof EngineEvents]: Set<(event: EngineEvents[Name]) => void> } =
    { pointer: new Set(), slide: new Set() };
  const overlays = new Map<string, OverlayLayer>();

  const currentBounds = (): CameraBounds => {
    if (bounds === null) {
      const viewport = slide && mounted ? mounted.container.getBoundingClientRect() : null;
      bounds = cameraBounds({
        slide,
        viewport,
        devicePixelRatio: devicePixelRatio(),
        cap: options.zoomLimits,
      });
    }
    return bounds;
  };

  let camera: Camera = clampCamera(originCamera, currentBounds());

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
    inFrame = true;
    let moving = false;
    try {
      moving = controller.step();
    } finally {
      inFrame = false;
      rect = null;
    }
    if (cameraDirty) notifyCamera();
    if (moving) requestFrame();
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
      if (!inFrame) requestFrame();
    }
    return rect;
  };

  const emit = <Name extends keyof EngineEvents>(name: Name, event: EngineEvents[Name]) => {
    const listeners = eventListeners[name] as Set<(value: EngineEvents[Name]) => void>;
    for (const listener of [...listeners]) listener(event);
  };

  const applyCamera = (next: Camera) => {
    const clamped = clampCamera(next, currentBounds());
    if (sameCamera(clamped, camera)) return;
    camera = clamped;
    mounted?.route.setCamera(camera);
    if (mounted) {
      cameraDirty = true;
      if (!inFrame) requestFrame();
    } else {
      notifyCamera();
    }
  };

  const reclamp = () => {
    bounds = null;
    applyCamera(camera);
  };

  const controller = createCameraController({
    bounds: currentBounds,
    now,
    getCamera: () => camera,
    applyCamera,
    viewport: () => (mounted ? measure(mounted.container) : null),
    requestFrame,
    animates: () => mounted !== null && !reducedMotion(),
    ...(options.cameraProfile ? { profile: options.cameraProfile } : {}),
  });

  const anchorOf = (at: ClientPoint | undefined): ScreenOffset | undefined => {
    if (!at || !mounted) return undefined;
    const viewport = measure(mounted.container);
    return {
      x: at.clientX - viewport.left - viewport.width / 2,
      y: at.clientY - viewport.top - viewport.height / 2,
    };
  };

  const flyToArea = (area: SlideArea) => {
    assertAlive();
    fitPending = false;
    const viewport = mounted ? measure(mounted.container) : null;
    const target =
      viewport && viewport.width > 0 && viewport.height > 0
        ? areaCamera(area, viewport, currentBounds())
        : { x: area.x + area.width / 2, y: area.y + area.height / 2, zoom: camera.zoom };
    return controller.flyTo(target);
  };

  const zoomToMagnification = (
    magnification: number,
    at?: ClientPoint,
    zoomOptions?: { readonly animate?: boolean },
  ): boolean => {
    assertAlive();
    const micronsPerPixel = slide?.micronsPerPixel ?? null;
    if (micronsPerPixel === null || !(magnification > 0)) return false;
    fitPending = false;
    controller.zoomTo(
      zoomForMagnification(micronsPerPixel, magnification),
      anchorOf(at),
      zoomOptions,
    );
    return true;
  };

  const fitIfPossible = () => {
    controller.cancel();
    bounds = null;
    if (!slide) {
      applyCamera(camera);
      return;
    }
    const viewport = mounted ? measure(mounted.container) : null;
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
      fitPending = true;
      const area = fitArea(slide, slide.tissue);
      applyCamera({ x: area.x + area.width / 2, y: area.y + area.height / 2, zoom: camera.zoom });
      return;
    }
    fitPending = false;
    applyCamera(fitCamera(slide, viewport, currentBounds(), slide.tissue));
  };

  const sortedOverlays = (): readonly OverlayLayer[] =>
    [...overlays.values()].sort((a, b) => a.order - b.order);

  const pointerListener =
    (kind: SlidePointerKind, container: EngineContainer) => (source: Event) => {
      if (kind === "down" || kind === "wheel") controller.interrupt();
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
        else reclamp();
      }),
    );
    mounted = { container, route, detach };
    bounds = null;
    route.setOverlays(sortedOverlays());
    route.showSlide(slide);
    route.setCamera(camera);
    if (fitPending) fitIfPossible();
    else reclamp();
  };

  const unmount = () => {
    if (!mounted) return;
    const { route, detach } = mounted;
    mounted = null;
    bounds = null;
    for (const remove of detach) remove();
    controller.settle();
    cancelFrame();
    if (cameraDirty) notifyCamera();
    route.destroy();
  };

  const closeCurrentSlide = () => {
    controller.cancel();
    const previous = slide;
    slide = null;
    slideInfo = null;
    fitPending = false;
    bounds = null;
    mounted?.route.showSlide(null);
    previous?.close();
  };

  const openSlide = async (ref: SlideRef): Promise<SlideInfo> => {
    assertAlive();
    pendingOpen?.abort();
    const opening = new AbortController();
    pendingOpen = opening;
    let opened: Slide;
    try {
      opened = await options.openSlide(ref, opening.signal);
    } catch (error) {
      if (pendingOpen === opening) pendingOpen = null;
      throw error;
    }
    if (disposed || pendingOpen !== opening) {
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
    reclamp();
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
    controller.cancel();
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
      controller.cancel();
      applyCamera(next);
    },
    fitToSlide: () => {
      assertAlive();
      fitIfPossible();
    },
    getMotion: () => controller.motion(),
    getCameraBounds: () => currentBounds(),
    getCameraProfile: () => controller.profile(),
    setCameraProfile: (profile) => {
      assertAlive();
      controller.setProfile(profile);
    },
    stopMotion: () => controller.cancel(),
    panBy: (dx, dy) => {
      assertAlive();
      fitPending = false;
      controller.panBy(dx, dy);
    },
    zoomTo: (zoom, at, zoomOptions) => {
      assertAlive();
      fitPending = false;
      controller.zoomTo(zoom, anchorOf(at), zoomOptions);
    },
    zoomBy: (octaves, at, zoomOptions) => {
      assertAlive();
      fitPending = false;
      controller.zoomBy(octaves, anchorOf(at), zoomOptions);
    },
    zoomToMagnification,
    startDrag: (at) => {
      assertAlive();
      fitPending = false;
      controller.startDrag(at.clientX, at.clientY);
    },
    dragTo: (at, ageMs = 0) => controller.dragTo(at.clientX, at.clientY, now() - ageMs),
    endDrag: () => controller.endDrag(),
    flyTo: (target) => {
      assertAlive();
      fitPending = false;
      return controller.flyTo(target);
    },
    flyToArea,
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
