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

export function pinnedMinimap(
  canvas: { width: number; height: number },
  box: { width: number; height: number },
  corner: Corner = "bottom-right",
): Placement {
  const [side, edge] = corner.split("-");
  return {
    corner,
    x: edge === "left" ? margin : canvas.width - box.width - margin,
    y: side === "top" ? margin : canvas.height - box.height - margin,
    score: 0,
  };
}

export const blockedScore = blockedCost;

export const narrowCanvas = 480;

export type CornerChoice = "auto" | "br" | "bl" | "tr" | "tl";

const choiceCorner: Record<Exclude<CornerChoice, "auto">, Corner> = {
  br: "bottom-right",
  bl: "bottom-left",
  tr: "top-right",
  tl: "top-left",
};

export function cornerOfChoice(choice: CornerChoice): Corner | null {
  return choice === "auto" ? null : choiceCorner[choice];
}

export function choiceOfCorner(corner: Corner): Exclude<CornerChoice, "auto"> {
  return corner === "bottom-right"
    ? "br"
    : corner === "bottom-left"
      ? "bl"
      : corner === "top-right"
        ? "tr"
        : "tl";
}

export function cornerOfPoint(
  canvas: { width: number; height: number },
  point: readonly [number, number],
): Corner {
  const side = point[1] < canvas.height / 2 ? "top" : "bottom";
  const edge = point[0] < canvas.width / 2 ? "left" : "right";
  return `${side}-${edge}`;
}

export function stepCorner(corner: Corner, key: string): Corner {
  const [side, edge] = corner.split("-");
  if (key === "ArrowLeft") return `${side}-left` as Corner;
  if (key === "ArrowRight") return `${side}-right` as Corner;
  if (key === "ArrowUp") return `top-${edge}` as Corner;
  if (key === "ArrowDown") return `bottom-${edge}` as Corner;
  return corner;
}

export function chosenPlacement(
  scored: Placement & { ranked: Placement[] },
  chosen: Corner | null,
): Placement {
  if (chosen === null) return scored;
  const wanted = scored.ranked.find((place) => place.corner === chosen);
  return wanted === undefined || wanted.score >= blockedCost ? scored : wanted;
}

export function fitsCanvas(
  canvas: { width: number; height: number },
  scored: { ranked: Placement[] },
): boolean {
  return canvas.width >= narrowCanvas && scored.ranked.some((place) => place.score < blockedCost);
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
