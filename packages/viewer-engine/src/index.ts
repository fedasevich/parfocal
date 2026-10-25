export const packageName = "@parfocal/viewer-engine";

export type {
  Camera,
  CameraBounds,
  CameraBoundsInput,
  ScreenRect,
  SlideArea,
  SlideExtent,
  SlidePoint,
  Viewport,
  ZoomLimits,
} from "./camera/camera.ts";
export {
  areaCamera,
  cameraBounds,
  clampCamera,
  clampZoom,
  defaultZoomLimits,
  fitArea,
  fitCamera,
  maxDevicePixelsPerSlidePixel,
  sameCamera,
  screenScale,
  screenToSlide,
  slideToScreen,
  tissueArea,
  tissueMarginShare,
  zoomOutShareOfFit,
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
export type { Flight, FlightTiming } from "./camera/flight.ts";
export {
  easeInOutCubic,
  flightCurvature,
  flightDurationMs,
  longestFlightLength,
  longestFlightMs,
  planFlight,
  shortestFlightMs,
  smoothFlightTiming,
} from "./camera/flight.ts";
export type { ObjectivePreset } from "./camera/magnification.ts";
export {
  magnificationAtZoom,
  micronsPerScreenPixelAtOneX,
  nearestObjectivePreset,
  objectivePresets,
  zoomForMagnification,
} from "./camera/magnification.ts";
export type { CoastStep, PointerSample, ScreenVelocity, ThrowFeel } from "./camera/physics.ts";
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
  smoothThrow,
  velocityWindowMs,
  zoomEaseMs,
  zoomSettleOctaves,
} from "./camera/physics.ts";
export type {
  CameraProfile,
  CameraProfilePreset,
  WheelInputKind,
  ZoomAnchor,
} from "./camera/profile.ts";
export {
  cameraProfiles,
  coasts,
  defaultCameraProfile,
  easesZoom,
  flies,
  wheelZoomOctaves,
  withoutMotion,
} from "./camera/profile.ts";
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
export {
  bindViewerInput,
  defaultCursors,
  type InputTarget,
  type ViewerInputBinding,
  type ViewerInputOptions,
} from "./input/dom-input.ts";
export {
  type CursorState,
  createGestureInterpreter,
  type DoubleClickInput,
  doubleClickOctaves,
  type GestureHooks,
  type GestureInterpreter,
  type InputAction,
  type InputModifiers,
  type InputPoint,
  middleButton,
  type PointerInput,
  type PointerInputKind,
  type PointerSampleInput,
  primaryButton,
  type ViewerInput,
  type WheelInput,
} from "./input/gestures.ts";
export {
  classifyWheel,
  freshWheelClassifier,
  isMacMouseStep,
  isPinchWheel,
  macMouseWheelStep,
  mouseEvidenceNeeded,
  mouseNotchMinimum,
  pinchDeltaMaximum,
  trackpadDeltaMaximum,
  type WheelClassifier,
  type WheelDelta,
  type WheelDevice,
  type WheelIntent,
  type WheelMode,
  wheelEventOctaves,
  wheelIntent,
  wheelLinePixels,
  wheelPagePixels,
  wheelPan,
  wheelPixels,
} from "./input/wheel.ts";
export {
  createPathBatch,
  createPointBatch,
  createPolygonBatch,
  type FlatBatch,
  type LineInput,
  type PointInput,
  type PolygonInput,
  pathBatchFromLines,
  pointBatchFromPoints,
  polygonBatchFromRings,
  triangulatePolygons,
} from "./overlay/batches.ts";
export {
  createOverlayController,
  type OverlayController,
  type OverlayHost,
} from "./overlay/controller.ts";
export {
  createPinOverlay,
  createRasterOverlay,
  createVectorOverlay,
  defaultOverlayState,
  defaultRasterSmoothing,
  defaultVectorStyles,
  isOverlayDescription,
  isPinOverlay,
  isRasterOverlay,
  type OverlayOptions,
  type PinOverlayOptions,
  type RasterOverlayOptions,
  type VectorOverlayOptions,
  withOverlayState,
} from "./overlay/overlay.ts";
export {
  createPinAtlas,
  type PinAtlas,
  type PinIconBox,
  type PinIconName,
  pinColors,
  pinIconSize,
} from "./overlay/pin-icons.ts";
export type {
  OverlayDescription,
  OverlayState,
  PathBatch,
  PinBatch,
  PinKind,
  PinOverlay,
  PointBatch,
  PolygonBatch,
  RasterData,
  RasterKind,
  RasterOverlay,
  Rgba,
  ShapeData,
  VectorKind,
  VectorOverlay,
  VectorStyle,
} from "./overlay/types.ts";
export {
  isOverlayKind,
  type OverlayKind,
  overlayOrder,
  overlayOrderStep,
  overlayStack,
} from "./overlay/z-order.ts";
export * from "./pixel-source/index.ts";
