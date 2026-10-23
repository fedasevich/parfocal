export const packageName = "@parfocal/viewer-engine";

export type {
  Camera,
  ScreenRect,
  SlideArea,
  SlideExtent,
  SlidePoint,
  Viewport,
  ZoomLimits,
} from "./camera/camera.ts";
export {
  areaCamera,
  clampCamera,
  clampZoom,
  defaultZoomLimits,
  fitCamera,
  sameCamera,
  screenScale,
  screenToSlide,
  slideToScreen,
} from "./camera/camera.ts";
export type {
  CameraController,
  CameraControllerHost,
  CameraMotion,
  FlightEnd,
  ScreenOffset,
  ZoomOptions,
} from "./camera/controller.ts";
export { createCameraController } from "./camera/controller.ts";
export type { Flight } from "./camera/flight.ts";
export {
  easeInOutCubic,
  flightCurvature,
  flightDurationMs,
  longestFlightLength,
  longestFlightMs,
  planFlight,
  shortestFlightMs,
} from "./camera/flight.ts";
export type { ObjectivePreset } from "./camera/magnification.ts";
export {
  magnificationAtZoom,
  micronsPerScreenPixelAtOneX,
  nearestObjectivePreset,
  objectivePresets,
  zoomForMagnification,
} from "./camera/magnification.ts";
export type { CoastStep, PointerSample, ScreenVelocity } from "./camera/physics.ts";
export {
  coastDecayMs,
  coastDistance,
  coastStep,
  coastStopSpeed,
  easeZoomStep,
  keepRecentSamples,
  minimumThrowSpeed,
  releaseIdleMs,
  releaseVelocity,
  velocityWindowMs,
  zoomEaseMs,
  zoomSettleOctaves,
} from "./camera/physics.ts";
export {
  createDecodePool,
  type DecodePool,
  DecodePoolDisposedError,
  type DecodePoolOptions,
  type DecodePoolStats,
  defaultDecodeWorkers,
  defaultRetainedResults,
  type PoolPoint,
} from "./decode/decode-pool.ts";
export {
  createRangeCache,
  defaultCachedBlocks,
  type RangeCache,
  type RangeCacheOptions,
  type RangeCacheStats,
  type RangeReply,
} from "./decode/range-cache.ts";
export {
  createViewerEngine,
  EngineDisposedError,
  SlideOpenSupersededError,
} from "./engine/engine.ts";
export type {
  ClientPoint,
  Clock,
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
