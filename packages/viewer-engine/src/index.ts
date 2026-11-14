export const packageName = "@parfocal/viewer-engine";

export {
  CrossOriginSlideBytesError,
  createSlideAccess,
  identifiedSlideFormat,
  LEVEL_TABLE_FILE,
  type LevelTable,
  LevelTableError,
  type LevelTableLevel,
  parseLevelTable,
  type SignedSlideOptions,
  type SlideAccess,
  SlideBytesError,
  signedOpenRequest,
  slideFormatFromName,
  slideIndexFromLevelTable,
  type TileGrant,
} from "./access/signed-slide.ts";
export type { Fetcher, Mint, MintedAccess } from "./access/tile-access.ts";
export { TileAccess } from "./access/tile-access.ts";
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
  selectionCamera,
  selectionMarginPx,
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
export type { LinkedView, LinkedViews, PaneViews, ViewOffset } from "./camera/linked-views.ts";
export {
  alignViews,
  alignWithOffset,
  createLinkedViews,
  isNoOffset,
  moveView,
  noOffset,
  offsetBetween,
  relinkViews,
  shiftView,
  toggleLinked,
  unlinkViews,
} from "./camera/linked-views.ts";
export type { ObjectivePreset } from "./camera/magnification.ts";
export {
  magnificationAtZoom,
  micronsPerScreenPixelAtOneX,
  nearestObjectivePreset,
  objectivePresets,
  zoomForMagnification,
} from "./camera/magnification.ts";
export type {
  MotionPrediction,
  MotionPredictor,
  MotionPredictorTuning,
  MotionVector,
} from "./camera/motion-predictor.ts";
export { createMotionPredictor, motionPredictorTuning } from "./camera/motion-predictor.ts";
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
export type { GrayImage, Registration } from "./camera/registration.ts";
export { registerThumbnails } from "./camera/registration.ts";
export type {
  MagnificationReadout,
  MicronsPerPixel,
  ScaleBar,
  ScaleBarInput,
} from "./camera/units.ts";
export {
  devicePixelsPerSlidePixel,
  digitalLabel,
  digitalTolerance,
  effectiveMagnification,
  formatLength,
  isDigital,
  knownSpacing,
  magnificationReadout,
  micronsPerDevicePixel,
  micronsPerScreenPixel,
  micronsToScreen,
  micronsToSlideLength,
  micronsToSlidePoint,
  niceScaleBarMicrons,
  scaleBar,
  scanObjective,
  scanObjectiveRatioLimit,
  screenToMicrons,
  slideLengthToMicrons,
  slidePointToMicrons,
  viewWidthMicrons,
} from "./camera/units.ts";
export type {
  BoundViewHistory,
  HistoryEngine,
  RestTimers,
  ViewHistory,
  ViewHistoryEntries,
} from "./camera/view-history.ts";
export {
  bindViewHistory,
  createViewHistory,
  sameView,
  viewHistoryLimit,
  viewRestMs,
} from "./camera/view-history.ts";
export {
  createDecodePool,
  type DecodePool,
  DecodePoolDisposedError,
  type DecodePoolOptions,
  type DecodePoolStats,
  defaultDecodeWorkers,
  defaultRetainedResults,
  type PoolPoint,
  type PrefetchStats,
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
  clampSlideBrightness,
  defaultSlideBrightness,
  maxSlideBrightness,
  minSlideBrightness,
  slideBrightnessFactor,
} from "./engine/brightness.ts";
export {
  createViewerEngine,
  EngineDisposedError,
  SlideOpenSupersededError,
} from "./engine/engine.ts";
export {
  createGuardedFrames,
  type GuardedFrameStats,
  type GuardedFrames,
  type GuardedFramesOptions,
} from "./engine/guarded-frames.ts";
export {
  createInteractionSignal,
  defaultRestMs,
  type InteractionSignal,
  type InteractionSignalOptions,
  type MovingListener,
} from "./engine/interaction-signal.ts";
export {
  type Cancel,
  createTimeSlice,
  defaultWatchdogMs,
  documentVisibility,
  messageTasks,
  type SchedulingOptions,
  systemTimers,
  type TabVisibility,
  type TaskScheduler,
  type TimerScheduler,
  type TimeSlice,
  yieldToMain,
} from "./engine/scheduling.ts";
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
  createMagnificationToggle,
  defaultCursors,
  type InputTarget,
  type ViewerInputBinding,
  type ViewerInputOptions,
} from "./input/dom-input.ts";
export {
  type CursorState,
  createGestureInterpreter,
  type DoubleClickBehaviour,
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
  advanceKeyPan,
  createKeyPan,
  fastKeyPanFactor,
  type KeyPan,
  type KeyPanHost,
  type KeyPanState,
  keyPanCruisePxPerMs,
  keyPanMoving,
  keyPanStepsPerSecond,
  keyPanTarget,
  keyZoomFactor,
  keyZoomOctaves,
  type PanDirection,
  restingKeyPan,
} from "./input/keyboard-pan.ts";
export {
  createTapRecognizer,
  type DoubleTap,
  type TapRecognizer,
  type TouchTuning,
  touchTuning,
} from "./input/touch.ts";
export {
  type ClickInput,
  isTwoFingerClick,
  safariPinchOctaves,
  secondaryButton,
} from "./input/trackpad.ts";
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
export type { CellChunk } from "./nuclei/cell-chunk.ts";
export { readCellChunk } from "./nuclei/cell-chunk.ts";
export type { CellConfidence } from "./nuclei/cell-confidence.ts";
export {
  calibratedShares,
  confidenceOf,
  isUnsureCell,
} from "./nuclei/cell-confidence.ts";
export { CellEdits } from "./nuclei/cell-edits.ts";
export type { CellSummary, ChunkEntry, Rect as CellRect } from "./nuclei/cell-summary.ts";
export {
  NO_ALTERNATIVE,
  numberOfRow,
  readCellSummary,
  rowOfNumber,
  UNCLASSIFIED,
  UNSURE_FLAG,
} from "./nuclei/cell-summary.ts";
export { ChunkCache, DEFAULT_VERTEX_BUDGET } from "./nuclei/chunk-cache.ts";
export type {
  CellSource,
  ClassNameOf,
  LoadedCell,
  PagedCellsOptions,
  PagedStats,
  ShowReport,
  UnsureCell,
} from "./nuclei/paged-cells.ts";
export {
  FETCH_BATCH,
  fetchBytes,
  httpCellSource,
  PAGED_ABOVE,
  PagedCells,
  VIEW_PAD,
} from "./nuclei/paged-cells.ts";
export type { PfcFile, PfcHeader } from "./nuclei/pfc.ts";
export { decodePfc, PfcError, readPfc, UnknownPfcVersionError } from "./nuclei/pfc.ts";
export {
  type AgreementCue,
  type AgreementKind,
  type AgreementObject,
  type AgreementOptions,
  type AgreementOverlays,
  agreementColours,
  agreementCueOf,
  agreementCues,
  agreementKinds,
  agreementOverlays,
  type ComparisonKind,
  comparisonKinds,
  comparisonLabels,
} from "./overlay/agreement.ts";
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
  colormapColor,
  colormapCssGradient,
  colormapSteps,
  heatmapColormaps,
  isHeatmapColormap,
} from "./overlay/colormaps.ts";
export {
  createOverlayController,
  type OverlayController,
  type OverlayHost,
} from "./overlay/controller.ts";
export {
  buildCullGrid,
  type CellRect as CullCells,
  type CullGrid,
  cellCount as cullCellCount,
  cellsIn,
  containsCells,
  cullCellDiameters,
  cullWindow,
  cullWindowMaxExcess,
  cullWindowPadCells,
  pointSubset,
  polygonSubset,
  rangeTotal,
  rowRanges,
  triangleStarts,
  type ViewRect,
  windowMembers,
} from "./overlay/cull-grid.ts";
export {
  belowCutoffAlpha,
  belowCutoffDash,
  type ColourMode,
  type CurrentObject,
  clampOpacity,
  colourModes,
  confidenceTint,
  confidenceTints,
  type DecisionName,
  type DrawMode,
  type DrawnObject,
  type DrawnOverlays,
  type DrawOptions,
  type DrawSettings,
  type DrawWidth,
  decisionColours,
  defaultDrawSettings,
  drawModes,
  drawObjectOverlays,
  drawWidths,
  filledAlpha,
  maxDrawOpacity,
  minDrawOpacity,
  objectColour,
  scoreColour,
} from "./overlay/draw-style.ts";
export {
  colorizeFieldMap,
  createFieldMapOverlay,
  defaultFieldMapOpacity,
  defaultFieldMapThreshold,
  type FieldMapKind,
  type FieldMapOptions,
  fieldMapColor,
  fieldMapKinds,
  fieldMapStops,
} from "./overlay/field-maps.ts";
export {
  colorizeHeatmap,
  createHeatmapOverlay,
  defaultHeatmapLook,
  defaultHeatmapOpacity,
  type HeatmapOverlay,
  type HeatmapOverlayOptions,
  heatmapSourceLabel,
  heatmapStrengthState,
  heatmapStrengthSteps,
  isHeatmapOverlay,
  snapHeatmapStrength,
  withHeatmapLook,
} from "./overlay/heatmap.ts";
export {
  defaultLabelMetrics,
  type LabelAnchor,
  type LabelMetrics,
  type LabelPlacement,
  type LabelPlacementOptions,
  labelBoxSize,
  labelsOverlap,
  type PlacedLabel,
  placedLabelBox,
  placeLabels,
} from "./overlay/labels.ts";
export {
  chooseLod,
  densityRaster,
  fullDetail,
  type LodChoice,
  type LodStats,
  type LodTier,
  largeShapes,
  lodDensityBelowPx,
  lodDotRadiusPx,
  lodDotsBelowPx,
  lodKey,
  lodLargeFactor,
  lodMinShapes,
  lodStats,
  shapeDiagonals,
  smallShapeCentres,
  smallShapeIds,
} from "./overlay/lod.ts";
export {
  createObjectDrawing,
  type DisplayDrawChoices,
  drawSettingsFromChoices,
  type ObjectDrawing,
  type ObjectDrawingOptions,
} from "./overlay/object-drawing.ts";
export {
  bandAlphas,
  type ConfidenceBand,
  closeCallMargin,
  confidenceBand,
  confidenceBandFloors,
  defaultOutlineMode,
  fadeAlpha,
  fadeStrength,
  isUnsureCall,
  type OutlineMode,
  type OutlineModeOptions,
  outlineAlpha,
  outlineModeOverlays,
  outlineModes,
  type TypedOutline,
  unsureDash,
  unsureStyle,
} from "./overlay/outline-modes.ts";
export {
  type ClassName,
  classColors,
  nearBlack,
  proposalDash,
  white,
} from "./overlay/outline-style.ts";
export {
  createLabelOverlay,
  createPinOverlay,
  createRasterOverlay,
  createVectorOverlay,
  defaultOverlayState,
  defaultRasterSmoothing,
  defaultVectorStyles,
  isLabelOverlay,
  isOverlayDescription,
  isPinOverlay,
  isRasterOverlay,
  type LabelOverlayOptions,
  labelBatchFromPlaced,
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
export {
  createPolygonBatchInWorker,
  type TriangulationWorker,
} from "./overlay/triangulation-worker.ts";
export type {
  HeatmapColormap,
  HeatmapData,
  HeatmapGrid,
  HeatmapLook,
  HeatmapSource,
  LabelBatch,
  LabelKind,
  LabelOverlay,
  LineCasing,
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
export {
  createPatchReader,
  defaultPatchCacheSize,
  locatePatch,
  type Patch,
  type PatchCacheStats,
  type PatchQuery,
  type PatchRead,
  type PatchReader,
  PatchReaderClosedError,
  type PatchSource,
  type PatchSourceInfo,
  patchHoldsPoint,
  patchMarginShare,
  planesToRgb,
  UnsupportedPatchError,
} from "./patch/patch-reader.ts";
export type { PatchReply, PatchRequest } from "./patch/protocol.ts";
export {
  createWorkerPatchReader,
  type PatchBytePorts,
  type PatchWorker,
  PatchWorkerError,
  spawnPatchWorker,
  type WorkerPatchReaderOptions,
} from "./patch/worker-client.ts";
export { type PatchWorkerScope, startPatchWorker } from "./patch/worker-runtime.ts";
export * from "./pixel-source/index.ts";
export {
  createInferenceEngine,
  defaultEmbeddingCapacity,
  EngineNotReadyError,
  type InferenceEngine,
  type InferenceEngineOptions,
  type SamBox,
  type SamEncoded,
  type SamGraphLoad,
  type SamOutput,
  type SamOutputs,
  type SamPoint,
  type SamPrompt,
  type SamPromptOutcome,
  type SamReady,
  samEmbeddingDims,
  samImageSize,
  samMaskInputSize,
  UnknownEmbeddingError,
  UnsupportedGraphInputError,
} from "./sam/inference-engine.ts";
export {
  createModelCache,
  describeModelLoad,
  hasOnnxProtobufHeader,
  type ModelCache,
  type ModelCacheEntryStore,
  type ModelCacheOptions,
  type ModelCacheStorage,
  ModelDownloadError,
  type ModelFetch,
  type ModelLoad,
  type ModelSource,
  type ModelStorageManager,
  type Revalidation,
} from "./sam/model-cache.ts";
export type { SamReply, SamRequest } from "./sam/protocol.ts";
export type { SamRuntime, SamSession, SamTensor } from "./sam/runtime.ts";
export {
  type BestMask,
  bestMask,
  fittedLogits,
  modelToSlide,
  patchContains,
  type SamFrame,
  type SamPatchGeometry,
  type SamPlanePoint,
  samFrame,
  samPixelMean,
  samPixelStd,
  samPixels,
  slideToModel,
} from "./sam/smart-prompt.ts";
export {
  graphRunsOn,
  type SamGraph,
  type SamProvider,
  type SamVariant,
  samGraphs,
  samProvider,
  samVariant,
} from "./sam/variants.ts";
export {
  createSamClient,
  type SamClient,
  SamClientClosedError,
  type SamClientOptions,
  type SamWorker,
  SamWorkerError,
  spawnSamWorker,
} from "./sam/worker-client.ts";
export {
  type SamWorkerDependencies,
  type SamWorkerScope,
  startSamWorker,
} from "./sam/worker-runtime.ts";
export type {
  CoverageGrid,
  CoverageRaster,
  CoverageShare,
  TissueRaster,
} from "./seen/coverage.ts";
export {
  bitsetBytes,
  cellCount,
  cellsInArea,
  coverageBaseCell,
  coverageGrid,
  coverageMagnification,
  coverageMaxSide,
  coveragePercent,
  coverageShare,
  decodeBits,
  emptyCoverage,
  encodeBits,
  hasBit,
  isSeen,
  markCells,
  mergeCoverage,
  sameGrid,
  seesCoverage,
  tissueOnGrid,
  viewArea,
} from "./seen/coverage.ts";
export type {
  CoverageSend,
  CoverageTimers,
  CoverageTracker,
  CoverageTrackerOptions,
} from "./seen/tracker.ts";
export {
  coverageBatchLimit,
  coverageFlushMs,
  createCoverageTracker,
} from "./seen/tracker.ts";
