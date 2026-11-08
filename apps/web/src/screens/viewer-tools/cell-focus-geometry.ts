export type Point = { x: number; y: number };
export type Direction = "left" | "right" | "up" | "down";
export type CellSpot = Point & { object: string; decided: boolean };
export type BarBox = { left: number; top: number; width: number; height: number };

const unit: Record<Direction, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

const coneCos = Math.cos(Math.PI / 4);

export function jumpTarget(
  cells: CellSpot[],
  from: string,
  direction: Direction,
): string | undefined {
  const origin = cells.find((cell) => cell.object === from);
  if (origin === undefined) return undefined;
  const way = unit[direction];
  const candidates = cells.flatMap((cell) => {
    if (cell.object === from) return [];
    const dx = cell.x - origin.x;
    const dy = cell.y - origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return [];
    const along = (dx * way.x + dy * way.y) / distance;
    return along >= coneCos ? [{ cell, distance }] : [];
  });
  const open = candidates.filter((item) => !item.cell.decided);
  const pool = open.length > 0 ? open : candidates;
  pool.sort((a, b) => a.distance - b.distance);
  return pool[0]?.cell.object;
}

export function nearestOpen(cells: CellSpot[], from: string): string | undefined {
  const origin = cells.find((cell) => cell.object === from);
  if (origin === undefined) return undefined;
  const distance = (cell: Point) => Math.hypot(cell.x - origin.x, cell.y - origin.y);
  return cells
    .filter((cell) => cell.object !== from && !cell.decided)
    .sort((a, b) => distance(a) - distance(b))[0]?.object;
}

export function placeBar(
  cell: Point,
  radius: number,
  bar: { width: number; height: number },
  size: { width: number; height: number },
  gap = 14,
  margin = 12,
): BarBox {
  const below = cell.y + radius + gap;
  const above = cell.y - radius - gap - bar.height;
  const fitsBelow = below + bar.height <= size.height - margin;
  const top = fitsBelow || above < margin ? below : above;
  const wanted = cell.x - bar.width / 2;
  const left = Math.min(
    Math.max(wanted, margin),
    Math.max(margin, size.width - bar.width - margin),
  );
  return { left, top, width: bar.width, height: bar.height };
}

export function touchesCircle(box: BarBox, centre: Point, radius: number): boolean {
  const nearestX = Math.min(Math.max(centre.x, box.left), box.left + box.width);
  const nearestY = Math.min(Math.max(centre.y, box.top), box.top + box.height);
  return Math.hypot(centre.x - nearestX, centre.y - nearestY) < radius;
}
