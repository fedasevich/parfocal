export { type BlockReport, blockReport } from "#blocks.ts";
export {
  type Comparison,
  compareFrames,
  describeComparison,
  diffFrame,
  EXACT,
  type Tolerance,
} from "#compare.ts";
export {
  assertFrameHasContent,
  type ContentMinimums,
  type ContentStats,
  contentProblems,
  contentStats,
  DEFAULT_CONTENT_MINIMUMS,
  EmptyFrameError,
} from "#content.ts";
export {
  createFrame,
  type Frame,
  flipRows,
  frameFromBase64,
  frameToBase64,
  type Rgb,
  swapRedAndBlue,
} from "#frame.ts";
export {
  checkGolden,
  type GoldenCheck,
  type GoldenOutcome,
  goldenPath,
  goldenUpdateRequested,
  UPDATE_COMMAND,
} from "#golden.ts";
export { decodePng, encodePng, readPng, writePng } from "#png.ts";
export { type ReferenceScene, renderReferenceScene } from "#reference-renderer.ts";
export { syntheticHeTile } from "#synthetic-tile.ts";
export {
  CODEC_TOLERANCES,
  type Codec,
  FORMAT_CODECS,
  SLIDE_FORMATS,
  type SlideFormat,
  toleranceFor,
} from "#tolerances.ts";
export {
  baselineFor,
  isBootstrapping,
  judgeVisual,
  staleBaselines,
  UI_DENSITIES,
  UI_THEMES,
  UI_TOLERANCE,
  type UiDensity,
  type UiTheme,
  VISUAL_APPROVE_COMMAND,
  type VisualCase,
  type VisualInput,
  type VisualJudgement,
  visualCase,
  visualCases,
  visualName,
} from "#visual.ts";
