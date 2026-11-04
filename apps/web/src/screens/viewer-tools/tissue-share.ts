import type { MapRect } from "@parfocal/ui/lib/minimap-box";

export const tissueBounds: MapRect = [0, 0, 1400, 1924];

export function tissueShareOnScreen(viewport: MapRect, tissue: MapRect = tissueBounds) {
  const width =
    Math.min(viewport[0] + viewport[2], tissue[0] + tissue[2]) - Math.max(viewport[0], tissue[0]);
  const height =
    Math.min(viewport[1] + viewport[3], tissue[1] + tissue[3]) - Math.max(viewport[1], tissue[1]);
  if (width <= 0 || height <= 0) return 0;
  return (width * height) / (tissue[2] * tissue[3]);
}
