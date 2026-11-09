export const swipeStart = 0.52;

const lowest = 0.04;
const highest = 0.96;
const step = 0.02;
const bigStep = 0.1;

export function clampSplit(split: number): number {
  if (!Number.isFinite(split)) return swipeStart;
  return Math.min(highest, Math.max(lowest, split));
}

export function splitFromPointer(clientX: number, left: number, width: number): number {
  if (width <= 0) return swipeStart;
  return clampSplit((clientX - left) / width);
}

export function splitAfterKey(split: number, key: string, shift: boolean): number | null {
  const amount = shift ? bigStep : step;
  if (key === "ArrowLeft" || key === "ArrowDown") return clampSplit(split - amount);
  if (key === "ArrowRight" || key === "ArrowUp") return clampSplit(split + amount);
  if (key === "Home") return lowest;
  if (key === "End") return highest;
  return null;
}

export function splitPercent(split: number): number {
  return Math.round(split * 100);
}
