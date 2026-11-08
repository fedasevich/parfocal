import type { DeveloperNavGroup, HudBox } from "@parfocal/ui/components/developer-drawer";
import { benchmarkColumns } from "../../lab/pan-sweep.ts";
import { sampleCatalogue } from "../../lab/synthetic-data.ts";
import type { SceneOf } from "../scenes.ts";
import { developerSectionKeys, rendererKeys } from "./developer-keys.ts";

export { developerSectionKeys, rendererKeys };

export type DeveloperScene = SceneOf<"developer">;

export type DeveloperSection = (typeof developerSectionKeys)[number];

export type Renderer = (typeof rendererKeys)[number];

export const developerNav: DeveloperNavGroup[] = [
  {
    title: "Viewer",
    items: [
      { value: "renderer", label: "Renderer" },
      { value: "tiles", label: "Tiles and source" },
      { value: "annot", label: "Annotations" },
      { value: "heatmap", label: "Heatmap" },
    ],
  },
  {
    title: "AI",
    items: [
      { value: "models", label: "Models" },
      { value: "typing", label: "Typing and confidence" },
      { value: "job", label: "Whole-slide job" },
    ],
  },
  {
    title: "Measure",
    items: [
      { value: "bench", label: "Benchmark" },
      { value: "hud", label: "HUD" },
    ],
  },
  { title: "Reference", items: [{ value: "ref", label: "URL and debug handle" }] },
];

export const sectionOfDeveloperScene = (scene: DeveloperScene): DeveloperSection =>
  scene === "webgpu" ? "renderer" : scene;

export const rendererOfDeveloperScene = (scene: DeveloperScene | undefined): Renderer =>
  scene === "webgpu" ? "webgpu" : "viv";

export const routeName = (renderer: Renderer, backend: string) =>
  ({
    viv: "viv · deck.gl webgl2",
    webgpu: "webgpu",
    deck: `deck.gl 9.4 · ${backend === "webgpu" ? "webgpu" : "webgl2"}`,
  })[renderer];

export const rendererHints: Record<Renderer, string> = {
  viv: "The default. Opens every format, and Zarr that is not 8-bit always opens here.",
  webgpu:
    "Our own WebGPU route, with GPU culling and motion prediction. Zarr that is not 8-bit still falls back to Viv.",
  deck: "deck.gl 9.4 layers, on WebGL2 or WebGPU.",
};

export const colourMaps: Record<string, string> = {
  viridis: "#440154, #3b528b, #21918c, #5ec962, #fde725",
  inferno: "#000004, #57106e, #bc3754, #f98e09, #fcffa4",
  turbo: "#30123b, #4686fb, #1ae4b6, #a2fc3c, #fabd2e, #e4460a, #7a0403",
};

export const sampleSlides: [string, string][] = sampleCatalogue
  .filter((slide) => slide.group === "format")
  .map((slide) => [slide.name, slide.detail]);

export const bigSlides: [string, string][] = sampleCatalogue
  .filter((slide) => slide.group === "big")
  .map((slide) => [slide.name, slide.detail]);

export const vivReadouts: HudBox[] = [
  [
    "ui thread",
    [
      ["rAF p50", "8.3 ms"],
      ["rAF p95", "12.1 ms"],
      ["fps", "60"],
    ],
  ],
  [
    "viv · deck.gl webgl2",
    [
      ["frame p50", "6.2 ms"],
      ["frame p95", "11.8 ms"],
      ["fps", "60"],
      ["render cost", "2.1 ms"],
      ["renders", "1,204"],
      ["tile loads", "412"],
    ],
  ],
  [
    "source",
    [
      ["kind", "ome-zarr"],
      ["size", "98,304 × 65,536"],
      ["gigapixels", "6.4"],
      ["levels", "9"],
      ["pixel size", "0.25 µm"],
      ["metadata", "84 ms"],
    ],
  ],
  [
    "annotations",
    [
      ["instances", "100,000"],
      ["drawn", "18,240"],
      ["cull", "cpu · 1.4 ms"],
      ["rtree build", "38 ms"],
      ["upload", "3.2 MB"],
    ],
  ],
  [
    "drawn",
    [
      ["shapes", "18,246"],
      ["nuclei", "18,240 / 100,000"],
      ["triangles", "412,880"],
      ["segments", "96,112"],
      ["markers", "6"],
      ["heatmap cells", "65,536"],
    ],
  ],
  [
    "camelyon",
    [
      ["rings", "14"],
      ["vertices", "2,210"],
      ["triangles", "4,388"],
      ["bytes", "61 KB"],
    ],
  ],
  [
    "buffers and net",
    [
      ["live", "214"],
      ["pooled", "96"],
      ["reuse", "81%"],
      ["in flight", "6"],
      ["queued", "14"],
      ["last net", "182 ms"],
      ["last decode", "4.2 ms"],
      ["fetched", "1,880"],
      ["late", "3"],
    ],
  ],
];

export const webgpuReadouts: HudBox[] = [
  [
    "webgpu",
    [
      ["frame p50 / p95", "3.1 / 5.4 ms"],
      ["fps", "60"],
      ["cpu per frame", "0.9 ms"],
      ["gpu frame", "1.6 ms"],
      ["level", "4"],
      ["tile draws", "96"],
    ],
  ],
  [
    "atlas",
    [
      ["slots", "512"],
      ["pinned", "24"],
      ["uploads", "1,204"],
      ["evictions", "310"],
      ["texture", "256 MB"],
      ["absent tiles", "0"],
    ],
  ],
  [
    "prediction",
    [
      ["signal", "pan"],
      ["confidence", "0.82"],
      ["lead level", "+1"],
      ["speculative", "12 pending"],
      ["issued", "340"],
      ["hits", "71%"],
      ["in flight", "4"],
    ],
  ],
];

export const urlParameters: [string, string, string][] = [
  ["renderer", "viv, webgpu, deck", "Renderer"],
  ["backend", "webgl, webgpu", "deck.gl backend"],
  ["nuclei", "0, 10k, 100k, 500k, 1m", "Synthetic nuclei"],
  ["cull", "gpu, cpu, none", "Culling, WebGPU only"],
  ["wheel", "auto, zoom, pan", "Mouse wheel, also in Settings"],
  ["interp", "auto, linear, nearest", "Interpolation, WebGPU only"],
  ["prefetch", "1, 0", "Prefetch ahead, WebGPU only"],
  ["vector", "1, 0", "Motion vector, WebGPU only"],
  ["src", "sample, path or URL", "Slide to open"],
  ["lod", "off, fade, dots, density, tiered", "Level of detail"],
  ["probe", "1, graph", "Frame probe"],
  ["seg", "pathosam, slimsam, flood, nuclick, watershed", "Segmentation provider"],
  ["samBatch", "number", "SAM batch size"],
  ["modelpause", "1, 0", "Pause models while moving"],
  ["paged", "auto, 1, 0", "Paged loading"],
  ["vivzarr", "1, 0", "Zarr on the main thread, Viv"],
  ["vivtex", "1, 0", "Float textures, Viv"],
  ["msaa", "1, 0", "MSAA, Viv"],
  ["earcut", "1, 0", "Earcut triangulation, Viv"],
  ["conf", "1, 0", "Confidence shown, also in Settings"],
  ["words", "plain, percent, frequency", "Wording, also in Settings"],
  ["confmode", "off, mark, fade, bands, map", "Confidence display, also in Settings"],
  ["cutoff", "number", "Tumor cutoff"],
];

export const benchParameters: [string, string, string][] = [
  ["graphs", "1, 0", "Charts on the page"],
  ["providers", "list", "Models to compare"],
  ["runs", "number", "Runs per model"],
  ["build", "name", "Build to label the results"],
  ["threads", "number", "WASM threads"],
  ["batches", "list", "Batch sizes to try"],
];

export const debugHandle: [string, string][] = [
  ["state", "App state"],
  ["getStats()", "The HUD numbers"],
  ["getSample()", "The open sample"],
  ["getCamera(), setCamera(c)", "Where the view is"],
  ["getRoute()", "Active renderer"],
  ["getLod()", "Level of detail now"],
  ["editor", "Annotation editor"],
  ["segmenter", "Segmentation models"],
  ["probe", "Frame probe"],
  ["learner", "Learned typer"],
  ["comments", "Comment threads"],
  ["getPyramid()", "Levels and tiles"],
  ["getPrediction(), pumpPrediction()", "Motion prediction, WebGPU"],
  ["runBenchmark(zoom)", "Pan sweep"],
  ["getSampleCount()", "Benchmark rows so far"],
  ["csv()", "Benchmark CSV"],
  ["measureThroughput(frames)", "Frames per second"],
  ["setNuclei(n)", "Synthetic nuclei"],
  ["setCullMode(m)", "Culling"],
  ["app", "Everything else"],
];

export const benchRuns: [string, string, number, string, string, number][] = [
  ["viv", "100k", 2, "6.2", "11.8", 60],
  ["webgpu", "100k", 2, "3.1", "5.4", 60],
  ["deck webgl2", "100k", 2, "8.9", "16.1", 58],
];

export const csvColumns = benchmarkColumns;
