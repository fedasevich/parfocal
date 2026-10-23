export const packageName = "@parfocal/viewer-engine";

export type {
  Camera,
  ScreenRect,
  SlideExtent,
  SlidePoint,
  ZoomLimits,
} from "./camera/camera.ts";
export {
  clampCamera,
  defaultZoomLimits,
  fitCamera,
  sameCamera,
  screenScale,
  screenToSlide,
  slideToScreen,
} from "./camera/camera.ts";
export {
  magnificationAtZoom,
  micronsPerScreenPixelAtOneX,
  zoomForMagnification,
} from "./camera/magnification.ts";
export {
  createViewerEngine,
  EngineDisposedError,
  SlideOpenSupersededError,
} from "./engine/engine.ts";
export type {
  EngineContainer,
  EngineEvents,
  EngineSlide,
  EngineStatus,
  FrameScheduler,
  OverlayLayer,
  OverlayRegistration,
  RendererFactory,
  RendererRoute,
  ResizeObserve,
  SlideInfo,
  SlideOpener,
  SlidePointerEvent,
  SlidePointerKind,
  SlideRef,
  Unsubscribe,
  ViewerEngine,
  ViewerEngineOptions,
} from "./engine/types.ts";
export * from "./pixel-source/index.ts";
