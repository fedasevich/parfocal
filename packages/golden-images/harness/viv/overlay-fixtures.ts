import {
  createPinOverlay,
  createRasterOverlay,
  createVectorOverlay,
  type OverlayDescription,
  type OverlayKind,
  pathBatchFromLines,
  pointBatchFromPoints,
  polygonBatchFromRings,
  type Rgba,
} from "@parfocal/viewer-engine";

export interface OverlayGeometry {
  readonly centre: { readonly x: number; readonly y: number };
  readonly slidePerScreen: number;
  readonly viewport: { readonly width: number; readonly height: number };
}

type Offset = readonly [dx: number, dy: number];

const rose: Rgba = [244, 63, 94, 255];
const amber: Rgba = [251, 191, 36, 255];
const lime: Rgba = [132, 204, 22, 255];
const cyan: Rgba = [34, 211, 238, 255];
const orange: Rgba = [251, 146, 60, 255];
const white: Rgba = [255, 255, 255, 255];

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function project(geometry: OverlayGeometry, offsets: readonly Offset[]): number[] {
  return offsets.flatMap(([dx, dy]) => [
    geometry.centre.x + dx * geometry.slidePerScreen,
    geometry.centre.y + dy * geometry.slidePerScreen,
  ]);
}

function blob(
  geometry: OverlayGeometry,
  centre: Offset,
  radius: number,
  sides: number,
  seed: number,
) {
  const random = seeded(seed);
  const ring: Offset[] = [];
  for (let side = 0; side < sides; side++) {
    const angle = (side / sides) * Math.PI * 2;
    const reach = radius * (0.75 + 0.5 * random());
    ring.push([centre[0] + Math.cos(angle) * reach, centre[1] + Math.sin(angle) * reach]);
  }
  return project(geometry, ring);
}

function rasterArea(geometry: OverlayGeometry) {
  const { centre, slidePerScreen, viewport } = geometry;
  return {
    x: centre.x - (viewport.width / 2) * slidePerScreen,
    y: centre.y - (viewport.height / 2) * slidePerScreen,
    width: viewport.width * slidePerScreen,
    height: viewport.height * slidePerScreen,
  };
}

function coverage(geometry: OverlayGeometry): OverlayDescription {
  const width = 16;
  const height = 12;
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (column >= 4 && row < 9) continue;
      rgba.set([52, 211, 153, 120], (row * width + column) * 4);
    }
  }
  return createRasterOverlay({
    id: "coverage",
    kind: "coverage",
    raster: { width, height, rgba, area: rasterArea(geometry) },
  });
}

function heatmap(geometry: OverlayGeometry): OverlayDescription {
  const width = 40;
  const height = 30;
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const dx = (column - width * 0.7) / (width * 0.22);
      const dy = (row - height * 0.3) / (height * 0.3);
      const value = Math.exp(-(dx * dx + dy * dy));
      rgba.set(
        [
          Math.round(255 * value),
          Math.round(200 * (1 - Math.abs(2 * value - 1))),
          Math.round(255 * (1 - value)),
          Math.round(30 + 190 * value),
        ],
        (row * width + column) * 4,
      );
    }
  }
  return createRasterOverlay({
    id: "heatmap",
    kind: "heatmap",
    raster: { width, height, rgba, area: rasterArea(geometry) },
  });
}

function nuclei(geometry: OverlayGeometry): OverlayDescription {
  const random = seeded(2_026_102_5);
  const classes = [lime, orange, cyan];
  const rings: { ring: number[]; color: Rgba }[] = [];
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 7; column++) {
      const centre: Offset = [-180 + column * 26 + random() * 8, -110 + row * 30 + random() * 8];
      rings.push({
        ring: blob(geometry, centre, 8, 9, 100 + row * 7 + column),
        color: classes[(row + column) % classes.length] ?? lime,
      });
    }
  }
  const dots = Array.from({ length: 36 }, (_, index) => ({
    x: geometry.centre.x + (20 + (index % 9) * 17 + random() * 6) * geometry.slidePerScreen,
    y:
      geometry.centre.y +
      (40 + Math.floor(index / 9) * 22 + random() * 6) * geometry.slidePerScreen,
    color: classes[index % classes.length] ?? lime,
  }));
  return createVectorOverlay({
    id: "nuclei",
    kind: "nuclei",
    shapes: { polygons: polygonBatchFromRings(rings), points: pointBatchFromPoints(dots) },
  });
}

function aiProposals(geometry: OverlayGeometry): OverlayDescription {
  const concave: Offset[] = [
    [-120, -60],
    [-40, -90],
    [30, -50],
    [-10, -10],
    [50, 20],
    [-30, 60],
    [-110, 30],
  ];
  return createVectorOverlay({
    id: "ai-proposals",
    kind: "ai-proposals",
    shapes: {
      polygons: polygonBatchFromRings([
        { ring: project(geometry, concave), color: cyan },
        { ring: blob(geometry, [110, -70], 34, 11, 7), color: cyan },
      ]),
    },
  });
}

function humanAnnotations(geometry: OverlayGeometry): OverlayDescription {
  const lShape: Offset[] = [
    [-90, -30],
    [10, -30],
    [10, 20],
    [-30, 20],
    [-30, 90],
    [-90, 90],
  ];
  const freehand: Offset[] = [
    [40, -110],
    [70, -80],
    [100, -95],
    [130, -50],
    [160, -60],
  ];
  return createVectorOverlay({
    id: "human-annotations",
    kind: "human-annotations",
    shapes: {
      polygons: polygonBatchFromRings([{ ring: project(geometry, lShape), color: rose }]),
      paths: pathBatchFromLines([{ line: project(geometry, freehand), color: amber }]),
      points: pointBatchFromPoints([
        {
          x: geometry.centre.x + 70 * geometry.slidePerScreen,
          y: geometry.centre.y + 70 * geometry.slidePerScreen,
          color: lime,
        },
        {
          x: geometry.centre.x + 100 * geometry.slidePerScreen,
          y: geometry.centre.y + 95 * geometry.slidePerScreen,
          color: rose,
        },
      ]),
    },
  });
}

function measurements(geometry: OverlayGeometry): OverlayDescription {
  const ruler: Offset[] = [
    [-150, 110],
    [-20, 80],
  ];
  const second: Offset[] = [
    [60, -20],
    [170, 20],
  ];
  const area: Offset[] = [
    [80, 60],
    [150, 50],
    [170, 110],
    [100, 125],
  ];
  const ends = [...ruler, ...second].map(([dx, dy]) => ({
    x: geometry.centre.x + dx * geometry.slidePerScreen,
    y: geometry.centre.y + dy * geometry.slidePerScreen,
    color: white,
  }));
  return createVectorOverlay({
    id: "measurements",
    kind: "measurements",
    shapes: {
      polygons: polygonBatchFromRings([{ ring: project(geometry, area), color: white }]),
      paths: pathBatchFromLines([
        { line: project(geometry, ruler), color: white },
        { line: project(geometry, second), color: white },
      ]),
      points: pointBatchFromPoints(ends),
    },
  });
}

function commentPins(geometry: OverlayGeometry): OverlayDescription {
  const spots: readonly [number, number, number][] = [
    [-150, -90, 0],
    [-20, 80, 1],
    [60, -20, 0],
    [130, 40, 1],
    [-60, 30, 0],
  ];
  const positions = new Float32Array(spots.length * 2);
  const resolved = new Uint8Array(spots.length);
  spots.forEach(([dx, dy, done], index) => {
    positions[index * 2] = geometry.centre.x + dx * geometry.slidePerScreen;
    positions[index * 2 + 1] = geometry.centre.y + dy * geometry.slidePerScreen;
    resolved[index] = done;
  });
  return createPinOverlay({
    id: "comment-pins",
    pins: { count: spots.length, positions, resolved },
  });
}

const builders: Readonly<Record<OverlayKind, (geometry: OverlayGeometry) => OverlayDescription>> = {
  coverage,
  heatmap,
  nuclei,
  "ai-proposals": aiProposals,
  "human-annotations": humanAnnotations,
  measurements,
  "comment-pins": commentPins,
};

export function overlayFixture(kind: OverlayKind, geometry: OverlayGeometry): OverlayDescription {
  return builders[kind](geometry);
}
