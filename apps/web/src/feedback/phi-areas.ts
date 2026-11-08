export const phiAttribute = "data-phi";

export const mediaSelector = "canvas, img, video, picture, iframe, object, embed, svg image";

export const phiSelector = [
  mediaSelector,
  `[${phiAttribute}]`,
  "h1",
  "nav[aria-label='breadcrumb']",
  "[data-slot='table-body']",
  "tbody",
  "[role='dialog']",
  "[role='listbox']",
  "[role='menu']",
  "[data-testid='patient-banner']",
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
].join(", ");

export const mosaicBlock = 16;
export const phiMargin = 6;

export type Area = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

export function grownArea(area: Area, margin: number): Area {
  return {
    x: area.x - margin,
    y: area.y - margin,
    width: area.width + margin * 2,
    height: area.height + margin * 2,
  };
}

export function clampedArea(area: Area, frame: Size): Area | null {
  const left = Math.max(0, Math.floor(area.x));
  const top = Math.max(0, Math.floor(area.y));
  const right = Math.min(frame.width, Math.ceil(area.x + area.width));
  const bottom = Math.min(frame.height, Math.ceil(area.y + area.height));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function blurAreas(found: Area[], frame: Size, margin = phiMargin): Area[] {
  return found.flatMap((area) => {
    if (area.width <= 0 || area.height <= 0) return [];
    const clamped = clampedArea(grownArea(area, margin), frame);
    return clamped ? [clamped] : [];
  });
}

export function routePath(pathname: string): string {
  const safe = pathname.replace(/[^A-Za-z0-9/_.-]/g, "");
  return (safe.startsWith("/") ? safe : `/${safe}`).slice(0, 300);
}

export function snappedArea(area: Area, block = mosaicBlock): Area {
  const x = Math.floor(area.x / block) * block;
  const y = Math.floor(area.y / block) * block;
  return {
    x,
    y,
    width: Math.ceil((area.x + area.width) / block) * block - x,
    height: Math.ceil((area.y + area.height) / block) * block - y,
  };
}

export function mosaic(pixels: Pixels, areas: Area[], block = mosaicBlock): void {
  const { width, height, data } = pixels;
  const done = new Set<number>();
  for (const area of areas) {
    const snapped = snappedArea(area, block);
    for (let top = snapped.y; top < snapped.y + snapped.height; top += block) {
      for (let left = snapped.x; left < snapped.x + snapped.width; left += block) {
        const key = (top / block) * Math.ceil(width / block) + left / block;
        if (done.has(key) || left >= width || top >= height) continue;
        done.add(key);
        const right = Math.min(width, left + block);
        const bottom = Math.min(height, top + block);
        const sum = new Float64Array(4);
        for (let y = top; y < bottom; y += 1) {
          for (let at = (y * width + left) * 4; at < (y * width + right) * 4; at += 1) {
            sum[at % 4] = (sum[at % 4] ?? 0) + (data[at] ?? 0);
          }
        }
        const count = (right - left) * (bottom - top);
        for (let y = top; y < bottom; y += 1) {
          for (let at = (y * width + left) * 4; at < (y * width + right) * 4; at += 1) {
            data[at] = Math.round((sum[at % 4] ?? 0) / count);
          }
        }
      }
    }
  }
}
