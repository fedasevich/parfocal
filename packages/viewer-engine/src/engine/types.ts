import type {
  Camera,
  CameraBounds,
  ScreenRect,
  SlideArea,
  SlideExtent,
  ZoomLimits,
} from "../camera/camera.ts";
import type { CameraMotion, FlightEnd, ZoomOptions } from "../camera/controller.ts";
import type { CameraProfile } from "../camera/profile.ts";

export type Unsubscribe = () => void;

export interface EngineContainer {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  getBoundingClientRect(): ScreenRect;
}

export interface SlideRef {
  readonly id: string;
}

export interface EngineSlide extends SlideExtent {
  readonly id: string;
  readonly micronsPerPixel: number | null;
  readonly tissue?: SlideArea | null;
  close(): void;
}

export type SlideOpener<Slide extends EngineSlide = EngineSlide> = (
  ref: SlideRef,
  signal: AbortSignal,
) => Promise<Slide>;

export interface OverlayLayer {
  readonly id: string;
  readonly order: number;
}

export interface RendererRoute<Slide extends EngineSlide = EngineSlide> {
  showSlide(slide: Slide | null): void;
  setCamera(camera: Camera): void;
  setOverlays(overlays: readonly OverlayLayer[]): void;
  invalidateOverlay(id: string): void;
  destroy(): void;
}

export type RendererFactory<Slide extends EngineSlide = EngineSlide> = (
  container: EngineContainer,
) => RendererRoute<Slide>;

export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export type Clock = () => number;

export interface ClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

export type ResizeObserve = (container: EngineContainer, onResize: () => void) => Unsubscribe;

export type SlidePointerKind = "down" | "move" | "up" | "cancel" | "leave" | "wheel";

export interface SlidePointerEvent {
  readonly kind: SlidePointerKind;
  readonly slideX: number;
  readonly slideY: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly buttons: number;
  readonly deltaY: number;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly source: Event;
}

export interface SlideInfo {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly micronsPerPixel: number | null;
}

export interface EngineEvents {
  pointer: SlidePointerEvent;
  slide: SlideInfo | null;
}

export interface OverlayRegistration {
  invalidate(): void;
  unregister(): void;
}

export type EngineStatus = "detached" | "mounted" | "disposed";

export interface ViewerEngineOptions<Slide extends EngineSlide = EngineSlide> {
  readonly createRenderer: RendererFactory<Slide>;
  readonly openSlide: SlideOpener<Slide>;
  readonly zoomLimits?: ZoomLimits;
  readonly frames?: FrameScheduler;
  readonly now?: Clock;
  readonly reducedMotion?: () => boolean;
  readonly devicePixelRatio?: () => number;
  readonly cameraProfile?: CameraProfile;
  readonly observeResize?: ResizeObserve;
}

export interface ViewerEngine {
  readonly status: () => EngineStatus;
  readonly mount: (container: EngineContainer) => void;
  readonly unmount: () => void;
  readonly openSlide: (ref: SlideRef) => Promise<SlideInfo>;
  readonly closeSlide: () => void;
  readonly getSlide: () => SlideInfo | null;
  readonly getCamera: () => Camera;
  readonly setCamera: (camera: Camera) => void;
  readonly fitToSlide: () => void;
  readonly getMotion: () => CameraMotion;
  readonly getCameraBounds: () => CameraBounds;
  readonly getCameraProfile: () => CameraProfile;
  readonly setCameraProfile: (profile: CameraProfile) => void;
  readonly stopMotion: () => void;
  readonly panBy: (dx: number, dy: number) => void;
  readonly zoomTo: (zoom: number, at?: ClientPoint, options?: ZoomOptions) => void;
  readonly zoomBy: (octaves: number, at?: ClientPoint, options?: ZoomOptions) => void;
  readonly zoomToMagnification: (
    magnification: number,
    at?: ClientPoint,
    options?: ZoomOptions,
  ) => boolean;
  readonly startDrag: (at: ClientPoint) => void;
  readonly dragTo: (at: ClientPoint, ageMs?: number) => void;
  readonly endDrag: () => void;
  readonly flyTo: (target: Camera) => Promise<FlightEnd>;
  readonly flyToArea: (area: SlideArea) => Promise<FlightEnd>;
  readonly subscribeCamera: (listener: () => void) => Unsubscribe;
  readonly on: <Name extends keyof EngineEvents>(
    name: Name,
    listener: (event: EngineEvents[Name]) => void,
  ) => Unsubscribe;
  readonly registerOverlay: (layer: OverlayLayer) => OverlayRegistration;
  readonly dispose: () => void;
}
