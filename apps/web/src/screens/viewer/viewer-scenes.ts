import type { Count } from "../review/decision-style.ts";
import type { SceneOf } from "../scenes.ts";

export const viewerTabs = ["objects", "display", "comments", "opinion"] as const;

export type ViewerTab = (typeof viewerTabs)[number];

export type CaseScene = SceneOf<"case">;

export type LayersScene = SceneOf<"layers">;

export type NavigatorScene = SceneOf<"navigator">;

export type CompareScene = SceneOf<"compare">;

export type ViewerScene = CaseScene | LayersScene | NavigatorScene | CompareScene;

export type LayerView =
  | "panel"
  | "heat"
  | "density"
  | "confidence"
  | "diff"
  | "models"
  | "readers"
  | "swipe"
  | "table";

export const layerViews: { value: LayerView; label: string }[] = [
  { value: "panel", label: "Objects on the slide" },
  { value: "heat", label: "Heatmap" },
  { value: "density", label: "Cell density" },
  { value: "confidence", label: "Confidence map" },
  { value: "diff", label: "AI vs reviewed" },
  { value: "models", label: "Model vs model" },
  { value: "readers", label: "Reviewer vs reviewer" },
  { value: "swipe", label: "Swipe between two sets" },
  { value: "table", label: "Object table and stats" },
];

export const mapViews: ReadonlySet<LayerView> = new Set(["heat", "density", "confidence"]);

export type ObjectFilter = "all" | "open" | Count | "added";

export type ViewerIssue = "slidefail" | "noresults" | "withdrawn";

export type ViewerSetup = {
  tab: ViewerTab;
  filter: ObjectFilter;
  object: string | null;
  cells: boolean;
  tiles: "sharp" | "loading" | "unloaded";
  tileHint: "loading" | "slow" | "unloaded" | null;
  sourceOff: boolean;
  issue: ViewerIssue | null;
  readOnly: boolean;
  connLost: boolean;
  submitFail: boolean;
  view: LayerView;
  confidenceLock: string | null;
  preset: string | null;
  presetOpen: boolean;
};

const base: ViewerSetup = {
  tab: "objects",
  filter: "all",
  object: null,
  cells: false,
  tiles: "sharp",
  tileHint: null,
  sourceOff: false,
  issue: null,
  readOnly: false,
  connLost: false,
  submitFail: false,
  view: "panel",
  confidenceLock: null,
  preset: null,
  presetOpen: false,
};

const display: Partial<ViewerSetup> = { tab: "display" };

const scenes: Record<ViewerScene, Partial<ViewerSetup>> = {
  objects: {},
  open: { filter: "open" },
  grid: { cells: true },
  running: {},
  loading: { tiles: "loading", tileHint: "loading" },
  unloaded: { tiles: "unloaded", tileHint: "unloaded" },
  submitfail: { tab: "opinion", submitFail: true },
  connlost: { connLost: true, object: "T5" },
  slidefail: { issue: "slidefail", object: "T5" },
  noresults: { issue: "noresults" },
  withdrawn: { issue: "withdrawn" },
  signedoff: { readOnly: true, object: "T5" },
  slow: { tiles: "loading", tileHint: "slow" },
  remoteoff: { sourceOff: true },
  panel: display,
  heat: { ...display, view: "heat" },
  density: { ...display, view: "density" },
  confidence: { ...display, view: "confidence" },
  diff: { ...display, view: "diff" },
  models: { ...display, view: "models" },
  readers: { ...display, view: "readers" },
  swipe: { ...display, view: "swipe" },
  table: { ...display, view: "table", object: "T2" },
  display,
  locked: { ...display, confidenceLock: "Confidence hidden this round" },
  preset: { ...display, preset: "Dots, no IDs", presetOpen: true },
  overview: {},
  reading: {},
  avoid: {},
  travel: {},
  cells: {},
  focus: {},
  pointer: {},
  picked: {},
  picking: {},
};

export function viewerSetup(scene: ViewerScene | undefined): ViewerSetup {
  return { ...base, ...(scene ? scenes[scene] : {}) };
}

const layersSceneSet: Record<LayersScene, true> = {
  panel: true,
  heat: true,
  density: true,
  confidence: true,
  diff: true,
  models: true,
  readers: true,
  swipe: true,
  table: true,
  display: true,
  locked: true,
  preset: true,
};

export const isLayersScene = (scene: ViewerScene | undefined) =>
  scene !== undefined && scene in layersSceneSet;

export const findingsObjects: Record<SceneOf<"findings">, string> = {
  open: "T5",
  decided: "T2",
  added: "T6⁺",
};

const navigatorSceneSet: Record<NavigatorScene, true> = {
  overview: true,
  reading: true,
  avoid: true,
  travel: true,
  cells: true,
  focus: true,
  pointer: true,
};

export const isNavigatorScene = (scene: ViewerScene | undefined): scene is NavigatorScene =>
  scene !== undefined && scene in navigatorSceneSet;

export const isCompareScene = (scene: ViewerScene | undefined): scene is CompareScene =>
  scene === "picked" || scene === "picking";
