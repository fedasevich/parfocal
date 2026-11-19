import { cellShapes } from "../../../apps/web/src/screens/review/slide-geometry.ts";
import {
  bandOrder,
  shortenTour,
  type TissueSpot,
  tissueOrder,
  tourLength,
} from "../../../apps/web/src/screens/review/strip-order.ts";
import {
  type CalmCamera,
  type CalmView,
  calmStep,
} from "../../../apps/web/src/viewer/calm-camera.ts";
import { outlinedCells } from "../../../packages/api-client/src/fake/scenario-review.ts";

const view: CalmView = { width: 1100, height: 800, bottomInset: 190 };

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<Item>(items: readonly Item[], random: () => number): Item[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other] as Item, out[index] as Item];
  }
  return out;
}

const slide = { width: 20000, height: 15000 };

function uniform(count: number, seed: number): TissueSpot[] {
  const random = seeded(seed);
  return Array.from({ length: count }, (_, index) => ({
    object: `C${index + 1}`,
    x: random() * slide.width,
    y: random() * slide.height,
  }));
}

function clustered(count: number, clusters: number, spread: number, seed: number): TissueSpot[] {
  const random = seeded(seed);
  const centres = Array.from({ length: clusters }, () => ({
    x: 1000 + random() * (slide.width - 2000),
    y: 1000 + random() * (slide.height - 2000),
  }));
  const bell = () => (random() + random() + random() + random() - 2) * spread;
  return Array.from({ length: count }, (_, index) => {
    const centre = centres[index % clusters] ?? { x: 0, y: 0 };
    return { object: `C${index + 1}`, x: centre.x + bell(), y: centre.y + bell() };
  });
}

function hilbertOrder(spots: readonly TissueSpot[]): string[] {
  const side = 1024;
  const left = Math.min(...spots.map((spot) => spot.x));
  const top = Math.min(...spots.map((spot) => spot.y));
  const span = Math.max(
    1,
    Math.max(...spots.map((spot) => spot.x)) - left,
    Math.max(...spots.map((spot) => spot.y)) - top,
  );
  const index = (spot: TissueSpot) => {
    let x = Math.min(side - 1, Math.floor(((spot.x - left) / span) * side));
    let y = Math.min(side - 1, Math.floor(((spot.y - top) / span) * side));
    let distance = 0;
    for (let step = side / 2; step > 0; step = Math.floor(step / 2)) {
      const rx = (x & step) > 0 ? 1 : 0;
      const ry = (y & step) > 0 ? 1 : 0;
      distance += step * step * ((3 * rx) ^ ry);
      if (ry === 0) {
        if (rx === 1) {
          x = step - 1 - x;
          y = step - 1 - y;
        }
        [x, y] = [y, x];
      }
    }
    return distance;
  };
  return [...spots].sort((a, b) => index(a) - index(b)).map((spot) => spot.object);
}

function nearestTour(spots: readonly TissueSpot[]): TissueSpot[] {
  const left = [...spots].sort((a, b) => a.x + a.y - (b.x + b.y));
  const tour = left.splice(0, 1);
  while (left.length > 0) {
    const at = tour.at(-1) as TissueSpot;
    let best = 0;
    left.forEach((spot, index) => {
      const now = left[best] as TissueSpot;
      if (Math.hypot(spot.x - at.x, spot.y - at.y) < Math.hypot(now.x - at.x, now.y - at.y))
        best = index;
    });
    tour.push(...left.splice(best, 1));
  }
  return tour;
}

type Travel = { perStep: number; longest: number; still: number };

function cameraTravel(
  order: readonly string[],
  spots: readonly TissueSpot[],
  scale: number,
  size: number,
  calm: boolean,
): Travel {
  const at = new Map(spots.map((spot) => [spot.object, spot]));
  const zoom = Math.log2(scale);
  const first = at.get(order[0] ?? "") ?? { x: 0, y: 0 };
  let camera: CalmCamera = { x: first.x, y: first.y, zoom };
  let total = 0;
  let longest = 0;
  let still = 0;
  for (const object of order.slice(1)) {
    const cell = at.get(object);
    if (cell === undefined) continue;
    const move = calm
      ? calmStep(camera, view, { x: cell.x, y: cell.y, size })
      : { kind: "pan" as const, camera: { x: cell.x, y: cell.y, zoom } };
    if (move.kind !== "pan") {
      still += 1;
      continue;
    }
    const widths =
      (Math.hypot(move.camera.x - camera.x, move.camera.y - camera.y) * scale) / view.width;
    total += widths;
    longest = Math.max(longest, widths);
    camera = move.camera;
  }
  const steps = Math.max(1, order.length - 1);
  return { perStep: total / steps, longest, still: still / steps };
}

const fromOutline = (object: string, outline: readonly number[] = []): TissueSpot => {
  const xs = outline.filter((_, index) => index % 2 === 0);
  const ys = outline.filter((_, index) => index % 2 === 1);
  return {
    object,
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
};

type Sample = { name: string; spots: TissueSpot[]; served: string[]; scale: number; size: number };

const asServed = (spots: readonly TissueSpot[]) => spots.map((spot) => spot.object);
const leastSureStandIn = (spots: readonly TissueSpot[], seed: number) =>
  shuffled(asServed(spots), seeded(seed));

const stageCells = outlinedCells.map((cell) => fromOutline(cell.object, cell.outline));
const prototypeCells = Object.entries(cellShapes).map(([object, shape]) => ({
  object,
  x: shape.x,
  y: shape.y,
}));

const synthetic = (name: string, spots: TissueSpot[], seed: number): Sample => ({
  name,
  spots,
  served: leastSureStandIn(spots, seed),
  scale: 1,
  size: 24,
});

const samples: Sample[] = [
  {
    name: "fake API stage cells (3)",
    spots: stageCells,
    served: asServed(stageCells),
    scale: 2,
    size: 14,
  },
  {
    name: "prototype field cells (12)",
    spots: prototypeCells,
    served: asServed(prototypeCells),
    scale: 2,
    size: 20,
  },
  synthetic("synthetic clustered 12, 3 groups", clustered(12, 3, 120, 63), 1),
  synthetic("synthetic clustered 50, 6 groups", clustered(50, 6, 240, 64), 2),
  synthetic("synthetic clustered 200, 12 groups", clustered(200, 12, 400, 65), 3),
  synthetic("synthetic uniform 50", uniform(50, 66), 4),
  synthetic("synthetic uniform 200", uniform(200, 67), 5),
];

const fixed = (value: number, digits = 2) => value.toFixed(digits);

for (const sample of samples) {
  const orders: [string, string[]][] = [
    ["as served", sample.served],
    ["bands of 2048 px", bandOrder(sample.spots)],
    ["Hilbert curve", hilbertOrder(sample.spots)],
    ["nearest neighbour", asServed(nearestTour(sample.spots))],
    ["nearest neighbour, 2-opt", asServed(shortenTour(nearestTour(sample.spots), 50))],
    ["clusters, then tour (chosen)", tissueOrder(sample.spots)],
  ];
  console.log(`\n### ${sample.name}\n`);
  console.log(
    "| Order | Path, slide px | Always centre, widths per step | Calm, widths per step | Calm, longest step | Calm, steps with no move |",
  );
  console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const [name, order] of orders) {
    const centred = cameraTravel(order, sample.spots, sample.scale, sample.size, false);
    const calm = cameraTravel(order, sample.spots, sample.scale, sample.size, true);
    console.log(
      `| ${name} | ${fixed(tourLength(order, sample.spots), 0)} | ${fixed(centred.perStep)} | ${fixed(calm.perStep)} | ${fixed(calm.longest)} | ${fixed(calm.still * 100, 0)}% |`,
    );
  }
}
