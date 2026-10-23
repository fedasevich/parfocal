import type {
  Camera,
  EngineContainer,
  EngineSlide,
  FrameScheduler,
  OverlayLayer,
  RendererRoute,
  ResizeObserve,
  ScreenRect,
  SlideRef,
} from "../src/index.ts";

export class FakeContainer implements EngineContainer {
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  rect: ScreenRect = { left: 100, top: 50, width: 800, height: 600 };
  measurements = 0;

  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  getBoundingClientRect(): ScreenRect {
    this.measurements += 1;
    return this.rect;
  }

  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }

  dispatch(type: string, init: Record<string, unknown>): void {
    const event = { type, ...init } as unknown as Event;
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

export class FakeFrames implements FrameScheduler {
  private next = 1;
  readonly pending = new Map<number, () => void>();

  request(callback: () => void): number {
    const handle = this.next++;
    this.pending.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.pending.delete(handle);
  }

  flush(): void {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback();
  }
}

export class FakeClock {
  time = 1000;

  readonly now = (): number => this.time;

  advance(ms: number): void {
    this.time += ms;
  }
}

export function runFrames(
  frames: FakeFrames,
  clock: FakeClock,
  frameMs = 16,
  limit = 1000,
): number {
  let count = 0;
  while (frames.pending.size > 0) {
    if (count >= limit) throw new Error(`Still animating after ${limit} frames`);
    clock.advance(frameMs);
    frames.flush();
    count += 1;
  }
  return count;
}

export class FakeResize {
  readonly active = new Map<EngineContainer, () => void>();

  readonly observe: ResizeObserve = (container, onResize) => {
    this.active.set(container, onResize);
    return () => {
      this.active.delete(container);
    };
  };

  fire(container: EngineContainer): void {
    this.active.get(container)?.();
  }
}

export interface FakeSlide extends EngineSlide {
  closed: boolean;
}

export function fakeSlide(id: string, width = 40_000, height = 30_000): FakeSlide {
  const slide: FakeSlide = {
    id,
    width,
    height,
    micronsPerPixel: 0.25,
    closed: false,
    close: () => {
      slide.closed = true;
    },
  };
  return slide;
}

export class FakeSource {
  readonly opened: FakeSlide[] = [];
  readonly signals: AbortSignal[] = [];
  private readonly waiting = new Map<string, (slide: FakeSlide) => void>();
  private readonly failing = new Map<string, (error: Error) => void>();
  deferred = false;

  readonly open = (ref: SlideRef, signal: AbortSignal): Promise<FakeSlide> => {
    this.signals.push(signal);
    const slide = fakeSlide(ref.id);
    this.opened.push(slide);
    if (!this.deferred) return Promise.resolve(slide);
    return new Promise((resolve, reject) => {
      this.waiting.set(ref.id, () => resolve(slide));
      this.failing.set(ref.id, reject);
    });
  };

  resolve(id: string): void {
    const opened = this.opened.find((slide) => slide.id === id);
    if (opened) this.waiting.get(id)?.(opened);
  }

  reject(id: string, error: Error): void {
    this.failing.get(id)?.(error);
  }
}

export class FakeRoute implements RendererRoute<FakeSlide> {
  slide: FakeSlide | null = null;
  camera: Camera | null = null;
  cameraCalls = 0;
  overlays: readonly OverlayLayer[] = [];
  invalidated: string[] = [];
  destroyed = false;
  readonly container: EngineContainer;

  constructor(container: EngineContainer) {
    this.container = container;
  }

  showSlide(slide: FakeSlide | null): void {
    this.slide = slide;
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.cameraCalls += 1;
  }

  setOverlays(overlays: readonly OverlayLayer[]): void {
    this.overlays = overlays;
  }

  invalidateOverlay(id: string): void {
    this.invalidated.push(id);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

export class FakeRenderer {
  readonly routes: FakeRoute[] = [];

  readonly create = (container: EngineContainer): FakeRoute => {
    const route = new FakeRoute(container);
    this.routes.push(route);
    return route;
  };

  alive(): FakeRoute[] {
    return this.routes.filter((route) => !route.destroyed);
  }

  last(): FakeRoute {
    const route = this.routes.at(-1);
    if (!route) throw new Error("No route was created");
    return route;
  }
}
