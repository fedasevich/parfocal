export type TissueSpot = { object: string; x: number; y: number };

export const clusterReach = 320;
export const bandHeight = 2048;
export const tourLimit = 600;

const between = (a: TissueSpot, b: TissueSpot) => Math.hypot(a.x - b.x, a.y - b.y);

const byName = (a: TissueSpot, b: TissueSpot) =>
  a.object < b.object ? -1 : a.object > b.object ? 1 : 0;

export function bandOrder(spots: readonly TissueSpot[], height = bandHeight): string[] {
  const keyed = spots.map((spot) => {
    const band = Math.floor(spot.y / height);
    return { spot, band, along: band % 2 === 0 ? spot.x : -spot.x };
  });
  keyed.sort((a, b) => a.band - b.band || a.along - b.along || byName(a.spot, b.spot));
  return keyed.map((item) => item.spot.object);
}

function clustersOf(spots: readonly TissueSpot[], reach: number): number[] {
  const parent = spots.map((_, index) => index);
  const root = (index: number): number => {
    let at = index;
    while (parent[at] !== at) at = parent[at] ?? at;
    return at;
  };
  spots.forEach((spot, index) => {
    for (let other = index + 1; other < spots.length; other += 1) {
      const next = spots[other];
      if (next !== undefined && between(spot, next) <= reach) parent[root(other)] = root(index);
    }
  });
  return spots.map((_, index) => root(index));
}

function nearest(
  from: TissueSpot,
  pool: readonly TissueSpot[],
  taken: ReadonlySet<TissueSpot>,
): TissueSpot | undefined {
  let best: TissueSpot | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const spot of pool) {
    if (taken.has(spot)) continue;
    const distance = between(from, spot);
    if (distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}

export function shortenTour(tour: TissueSpot[], passes = 20): TissueSpot[] {
  const path = [...tour];
  const gap = (a: number, b: number) => {
    const from = path[a];
    const to = path[b];
    return from === undefined || to === undefined ? 0 : between(from, to);
  };
  for (let pass = 0; pass < passes; pass += 1) {
    let improved = false;
    for (let first = 1; first < path.length - 1; first += 1) {
      for (let last = first + 1; last < path.length; last += 1) {
        const before = gap(first - 1, first) + gap(last, last + 1);
        const after = gap(first - 1, last) + gap(first, last + 1);
        if (after < before - 1e-9) {
          path.splice(first, last - first + 1, ...path.slice(first, last + 1).reverse());
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return path;
}

function tourFrom(entry: TissueSpot, members: readonly TissueSpot[]): TissueSpot[] {
  const taken = new Set<TissueSpot>([entry]);
  const tour = [entry];
  let at = entry;
  for (;;) {
    const next = nearest(at, members, taken);
    if (next === undefined) break;
    taken.add(next);
    tour.push(next);
    at = next;
  }
  return shortenTour(tour);
}

const cornerMost = (spots: readonly TissueSpot[]) =>
  spots.reduce<TissueSpot | undefined>(
    (best, spot) => (best === undefined || spot.x + spot.y < best.x + best.y ? spot : best),
    undefined,
  );

export function tissueOrder(spots: readonly TissueSpot[], reach = clusterReach): string[] {
  const sorted = [...spots].sort(byName);
  if (sorted.length > tourLimit) return bandOrder(sorted);
  const cluster = clustersOf(sorted, reach);
  const groups = new Map<number, TissueSpot[]>();
  sorted.forEach((spot, index) => {
    const key = cluster[index] ?? index;
    groups.set(key, [...(groups.get(key) ?? []), spot]);
  });
  const members = new Map<TissueSpot, TissueSpot[]>();
  for (const group of groups.values()) {
    const middle: TissueSpot = {
      object: group[0]?.object ?? "",
      x: group.reduce((sum, spot) => sum + spot.x, 0) / group.length,
      y: group.reduce((sum, spot) => sum + spot.y, 0) / group.length,
    };
    members.set(middle, group);
  }
  const middles = [...members.keys()];
  const firstGroup = cornerMost(middles);
  if (firstGroup === undefined) return [];
  const order: TissueSpot[] = [];
  for (const middle of tourFrom(firstGroup, middles)) {
    const group = members.get(middle) ?? [];
    const exit = order.at(-1);
    const entry = exit === undefined ? cornerMost(group) : nearest(exit, group, new Set());
    if (entry !== undefined) order.push(...tourFrom(entry, group));
  }
  return order.map((spot) => spot.object);
}

export function tourLength(order: readonly string[], spots: readonly TissueSpot[]): number {
  const at = new Map(spots.map((spot) => [spot.object, spot]));
  let total = 0;
  for (let index = 1; index < order.length; index += 1) {
    const from = at.get(order[index - 1] ?? "");
    const to = at.get(order[index] ?? "");
    if (from !== undefined && to !== undefined) total += between(from, to);
  }
  return total;
}
