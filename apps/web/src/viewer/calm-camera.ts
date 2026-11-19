export type CalmCamera = { x: number; y: number; zoom: number };
export type CalmView = { width: number; height: number; bottomInset: number };
export type CalmCell = { x: number; y: number; size: number };
export type CalmStep = { kind: "stay" } | { kind: "pan"; camera: CalmCamera } | { kind: "fly" };

export const comfortShare = 0.65;
export const smallestJudgedPx = 12;
export const largestShare = 0.5;

export function calmStep(camera: CalmCamera, view: CalmView, cell: CalmCell): CalmStep {
  const clearHeight = view.height - view.bottomInset;
  if (view.width <= 0 || clearHeight <= 0) return { kind: "fly" };
  const scale = 2 ** camera.zoom;
  const shown = cell.size * scale;
  if (shown < smallestJudgedPx || shown > largestShare * Math.min(view.width, clearHeight))
    return { kind: "fly" };
  const lift = view.bottomInset / 2;
  const dx = (cell.x - camera.x) * scale;
  const dy = (cell.y - camera.y) * scale + lift;
  const inside =
    Math.abs(dx) <= (comfortShare * view.width) / 2 &&
    Math.abs(dy) <= (comfortShare * clearHeight) / 2;
  if (inside) return { kind: "stay" };
  return { kind: "pan", camera: { x: cell.x, y: cell.y + lift / scale, zoom: camera.zoom } };
}

export const cellLandingPower = 40;

export function landingPower(scanPower: number | null): number | null {
  return scanPower !== null && scanPower > 0 ? Math.min(cellLandingPower, scanPower) : null;
}

export function landingCamera(
  view: CalmView | null,
  cell: { x: number; y: number },
  zoom: number,
): CalmCamera {
  const lift = (view?.bottomInset ?? 0) / 2;
  return { x: cell.x, y: cell.y + lift / 2 ** zoom, zoom };
}

export function stageCalmView(): CalmView | null {
  const strip = document.querySelector('[data-testid="stage-cells-grid"]');
  const host = (strip?.closest('[data-testid="slide-stage"]') ?? document).querySelector(
    '[data-testid="slide-host"]',
  );
  if (host === null) return null;
  const box = host.getBoundingClientRect();
  const stripTop = strip?.getBoundingClientRect().top ?? box.bottom;
  return {
    width: box.width,
    height: box.height,
    bottomInset: Math.min(box.height, Math.max(0, box.bottom - stripTop)),
  };
}
