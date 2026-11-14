import type { GeoTIFFImage } from "geotiff";
import type { MicronsPerPixel } from "../types.ts";
import { loadTag } from "./directory.ts";

export const USABLE_MICRONS_PER_PIXEL = 100;

const micronsPerUnit: Record<string, number> = {
  m: 1e6,
  cm: 1e4,
  mm: 1e3,
  µm: 1,
  um: 1,
  nm: 1e-3,
};

const micronsPerResolutionUnit: Record<number, number> = { 2: 25_400, 3: 10_000 };

function usable(x: number, y: number): MicronsPerPixel | null {
  const ok = (value: number) =>
    Number.isFinite(value) && value > 0 && value <= USABLE_MICRONS_PER_PIXEL;
  return ok(x) && ok(y) ? { x, y } : null;
}

function attribute(element: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(element)?.[1];
}

const philipsScannedImage = 'ObjectType="DPScannedImage"';
const philipsSpacing = /Name="DICOM_PIXEL_SPACING"[^>]*>([^<]*)</;
const micronsPerMillimetre = 1000;

export function micronsFromPhilipsDescription(description: string): MicronsPerPixel | null {
  if (!description.includes('ObjectType="DPUfsImport"')) return null;
  const slide = description
    .split(philipsScannedImage)
    .slice(1)
    .find((image) => /Name="PIM_DP_IMAGE_TYPE"[^>]*>WSI</.test(image));
  const spacing = philipsSpacing.exec(slide ?? "")?.[1];
  if (spacing === undefined) return null;
  const [rows, columns] = Array.from(spacing.matchAll(/[0-9.]+(?:e-?[0-9]+)?/gi), (match) =>
    Number(match[0]),
  );
  if (rows === undefined || columns === undefined) return null;
  return usable(columns * micronsPerMillimetre, rows * micronsPerMillimetre);
}

export function micronsFromDescription(description: string): MicronsPerPixel | null {
  const aperio = /\bMPP\s*=\s*([0-9.]+)/i.exec(description)?.[1];
  if (aperio !== undefined) return usable(Number(aperio), Number(aperio));
  const philips = micronsFromPhilipsDescription(description);
  if (philips !== null) return philips;
  const pixels = /<(?:\w+:)?Pixels\b[^>]*>/.exec(description)?.[0];
  if (pixels === undefined) return null;
  const size = (axis: "X" | "Y") => {
    const value = attribute(pixels, `PhysicalSize${axis}`);
    if (value === undefined) return Number.NaN;
    const unit = attribute(pixels, `PhysicalSize${axis}Unit`) ?? "µm";
    return Number(value) * (micronsPerUnit[unit] ?? Number.NaN);
  };
  return usable(size("X"), size("Y"));
}

function rational(value: unknown): number {
  if (typeof value === "number") return value;
  if (value !== null && typeof value === "object" && "length" in value) {
    const [numerator, denominator] = Array.from(value as ArrayLike<number>, Number);
    if (numerator === undefined) return Number.NaN;
    return numerator / (denominator === undefined || denominator === 0 ? 1 : denominator);
  }
  return Number.NaN;
}

export async function readMicronsPerPixel(image: GeoTIFFImage): Promise<MicronsPerPixel | null> {
  const description = await loadTag(image, "ImageDescription");
  if (typeof description === "string") {
    const described = micronsFromDescription(description);
    if (described !== null) return described;
  }
  const unit = Number((await loadTag(image, "ResolutionUnit")) ?? 2);
  const perUnit = micronsPerResolutionUnit[unit];
  if (perUnit === undefined) return null;
  const x = rational(await loadTag(image, "XResolution"));
  const y = rational(await loadTag(image, "YResolution"));
  return usable(perUnit / x, perUnit / y);
}
