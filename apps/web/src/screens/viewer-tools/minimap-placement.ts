export type ScreenRect = [number, number, number, number];

export type HotSpot = [number, number, number?];

export type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export type Placement = { corner: Corner; x: number; y: number; score: number };

const margin = 12;

const clearance = 10;

const blockedCost = 1000;

const overlaps = (a: ScreenRect, b: ScreenRect) =>
  a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

export function placeMinimap(
  canvas: { width: number; height: number },
  box: { width: number; height: number },
  hot: HotSpot[],
  blocked: ScreenRect[],
): Placement & { ranked: Placement[] } {
  const right = canvas.width - box.width - margin;
  const bottom = canvas.height - box.height - margin;
  const corners: [Corner, number, number, number][] = [
    ["bottom-right", right, bottom, 0],
    ["bottom-left", margin, bottom, 0.5],
    ["top-right", right, margin, 1],
    ["top-left", margin, margin, 1.5],
  ];
  const ranked = corners
    .map(([corner, x, y, preference]) => {
      const area: ScreenRect = [
        x - clearance,
        y - clearance,
        box.width + 2 * clearance,
        box.height + 2 * clearance,
      ];
      let score = preference;
      for (const [px, py, weight = 1] of hot) {
        if (px > area[0] && px < area[0] + area[2] && py > area[1] && py < area[1] + area[3])
          score += weight;
      }
      for (const rect of blocked) if (overlaps(area, rect)) score += blockedCost;
      return { corner, x, y, score };
    })
    .sort((a, b) => a.score - b.score);
  const best = ranked[0] ?? { corner: "bottom-right" as const, x: right, y: bottom, score: 0 };
  return { ...best, ranked };
}

export function pathPoints(path: string): [number, number][] {
  return path
    .replace(/^M/, "")
    .replace(/Z$/, "")
    .split("L")
    .map((pair) => pair.split(",").map(Number) as [number, number]);
}

export const cornerWord: Record<Corner, string> = {
  "bottom-right": "bottom right",
  "bottom-left": "bottom left",
  "top-right": "top right",
  "top-left": "top left",
};
