import { magnificationBarRect } from "@parfocal/ui/lib/magnification-bar";
import { type MapRect, type MinimapSize, minimapBox } from "@parfocal/ui/lib/minimap-box";
import { type Pin, pinOnScreen } from "../review/comment-pin.ts";
import { cellShapes, hpfSize, midSize, regionShapes } from "../review/slide-geometry.ts";
import type { Camera, StillLook } from "../review/slide-still.tsx";
import { type EdgeCue, edgeCues, neighbourTargets } from "./edge-cues.ts";
import { type HotSpot, pathPoints, type ScreenRect } from "./minimap-placement.ts";
import { chromeBlocks, hotWeight, measurementSpots } from "./minimap-weights.ts";
import { autoRegionProposals, cellsUnderReview, midEdge } from "./tool-geometry.ts";
import { areaExtent, boxCentre, coverHome, type Size, toScreen, viewportOf } from "./tool-maths.ts";

export type MapSpots = {
  hot: HotSpot[];
  blocked: ScreenRect[];
  size: MinimapSize;
  extent: MapRect;
};

export type NavigatorMapScene = "reading" | "travel" | "avoid" | "pointer" | "cells" | "focus";

export const overviewExtent: MapRect = [0, 0, 1400, 1924];

export const edgePoints = pathPoints(midEdge);

type Look = { look: StillLook; home: (size: Size) => Camera; magnification: number };

export const navigatorLooks: Record<"reading" | "cells" | "focus", Look> = {
  reading: { look: "mid", home: coverHome(midSize, [700, 520]), magnification: 10 },
  cells: {
    look: "hpf",
    home: coverHome(hpfSize, [cellsUnderReview[4]?.x ?? 800, cellsUnderReview[4]?.y ?? 500], 1.05),
    magnification: 40,
  },
  focus: {
    look: "hpf",
    home: coverHome(
      hpfSize,
      [cellsUnderReview[5]?.x ?? 800, (cellsUnderReview[5]?.y ?? 540) - 40],
      2.1,
    ),
    magnification: 40,
  },
};

export const navigatorLookOf = (scene: NavigatorMapScene) =>
  scene === "cells"
    ? navigatorLooks.cells
    : scene === "focus"
      ? navigatorLooks.focus
      : navigatorLooks.reading;

export const avoidRuler = (size: Size) => ({
  from: { x: size.width - 330, y: size.height - 190 },
  to: { x: size.width - 95, y: size.height - 130 },
});

export type NavigatorSpots = MapSpots & { cues: EdgeCue[] };

export function navigatorSpots(
  scene: NavigatorMapScene,
  shown: Camera,
  size: Size,
  context: { areaObjects: string[]; current: string; barOpen: boolean },
  chrome: { openThread?: ScreenRect | null; cellsPanel?: ScreenRect | null } = {},
): NavigatorSpots {
  const setup = navigatorLookOf(scene);
  const reading = setup.look === "mid";
  const viewport = viewportOf(setup.look, shown, size);
  const blocked: ScreenRect[] = [
    magnificationBarRect(size, { open: context.barOpen, brightnessChanged: false }),
    ...chromeBlocks(chrome),
  ];
  const hot: HotSpot[] = [];
  let mapSize: MinimapSize = "full";
  let extent: MapRect = overviewExtent;
  let cues: EdgeCue[] = [];
  if (reading) {
    cues = edgeCues(
      size,
      viewport,
      neighbourTargets(context.areaObjects, context.current, (object) => {
        const shape = regionShapes[object];
        return shape ? boxCentre(shape.box) : undefined;
      }),
    );
    for (const point of edgePoints) {
      const at = toScreen(shown, size, point);
      hot.push([at.x, at.y, hotWeight.tumorEdge]);
    }
    for (const cue of cues) blocked.push(cue.rect);
    if (scene === "travel") mapSize = "travel";
    if (scene === "avoid") {
      const ruler = avoidRuler(size);
      hot.push(...measurementSpots([ruler.from.x, ruler.from.y], [ruler.to.x, ruler.to.y]));
    }
  } else {
    const cellAt = scene === "focus" ? cellsUnderReview[5] : cellsUnderReview[4];
    mapSize = scene === "focus" ? "pip" : "compact";
    extent = areaExtent("T2");
    for (const other of cellsUnderReview) {
      if (other === cellAt) continue;
      const at = toScreen(shown, size, [other.x, other.y]);
      hot.push([at.x, at.y, hotWeight.cellToCheck]);
    }
    if (cellAt) {
      const at = toScreen(shown, size, [cellAt.x, cellAt.y]);
      hot.push([at.x, at.y, hotWeight.currentCell]);
    }
    if (scene === "focus") blocked.push([size.width / 2 - 290, size.height - 192, 580, 120]);
  }
  return { hot, blocked, size: mapSize, extent, cues };
}

export const annotateCentre = cellsUnderReview[2] ?? { x: 676, y: 834 };

export const annotatePromptBox = {
  x: annotateCentre.x - 110,
  y: annotateCentre.y - 150,
  size: 300,
};

export const annotateHome = coverHome(hpfSize, [annotateCentre.x + 60, annotateCentre.y], 1.6);

export function annotateSpots(
  shown: Camera,
  size: Size,
  chrome: { openThread?: ScreenRect | null; cellsPanel?: ScreenRect | null } = {},
): MapSpots {
  const corner = toScreen(shown, size, [annotatePromptBox.x, annotatePromptBox.y]);
  const hot: HotSpot[] = autoRegionProposals.map((cell) => {
    const at = toScreen(shown, size, [cell.x, cell.y]);
    return [at.x, at.y, hotWeight.proposal];
  });
  const blocked: ScreenRect[] = [
    [size.width / 2 - 250, size.height - 58, 500, 50],
    [size.width / 2 - 370, 6, 740, 50],
    [
      corner.x,
      corner.y,
      annotatePromptBox.size * shown.scale,
      annotatePromptBox.size * shown.scale,
    ],
    ...chromeBlocks(chrome),
  ];
  return { hot, blocked, size: "compact", extent: areaExtent("T2") };
}

export const focusHome = coverHome(midSize, [700, 520]);

export function focusSpots(shown: Camera, size: Size): MapSpots {
  const hot: HotSpot[] = edgePoints.map((point) => {
    const at = toScreen(shown, size, point);
    return [at.x, at.y, hotWeight.tumorEdge];
  });
  const blocked: ScreenRect[] = [
    [size.width / 2 - 250, size.height - 58, 500, 50],
    [size.width - 330, size.height - 170, 316, 156],
    [size.width / 2 - 170, 0, 340, 50],
  ];
  return { hot, blocked, size: "full", extent: overviewExtent };
}

export const mapBoxOf = (spots: MapSpots) => minimapBox(spots.size, spots.extent);

export type ViewerSpotsInput = {
  camera: Camera;
  size: Size;
  blockLeft: boolean;
  blockToast: boolean;
  cells: { object: string; decided: boolean }[];
  currentCell: string | undefined;
  pins: Pin[];
  proposals: { x: number; y: number }[];
  openThread: ScreenRect | null;
  cellsPanel: ScreenRect | null;
};

export const wholeSlideButtonWidth = 140;

export const toastWidth = 340;

export function viewerSpots(input: ViewerSpotsInput): Pick<MapSpots, "hot" | "blocked"> {
  const { camera, size } = input;
  const blocked: ScreenRect[] = [
    magnificationBarRect(size, { open: false, brightnessChanged: false }),
    ...chromeBlocks({ openThread: input.openThread, cellsPanel: input.cellsPanel }),
  ];
  if (input.blockLeft) blocked.push([16, size.height - 60, wholeSlideButtonWidth, 44]);
  if (input.blockToast) {
    blocked.push([size.width - toastWidth, size.height - 64, toastWidth - 16, 48]);
  }
  const hot: HotSpot[] = [];
  for (const cell of input.cells) {
    const shape = cellShapes[cell.object];
    const isCurrent = cell.object === input.currentCell;
    if (!shape || (cell.decided && !isCurrent)) continue;
    const at = toScreen(camera, size, [shape.x, shape.y]);
    hot.push([at.x, at.y, isCurrent ? hotWeight.currentCell : hotWeight.cellToCheck]);
  }
  for (const pin of input.pins) {
    const at = pinOnScreen(camera, size, pin);
    hot.push([at.x, at.y, hotWeight.pin]);
  }
  for (const proposal of input.proposals) {
    const at = toScreen(camera, size, [proposal.x, proposal.y]);
    hot.push([at.x, at.y, hotWeight.proposal]);
  }
  return { hot, blocked };
}
