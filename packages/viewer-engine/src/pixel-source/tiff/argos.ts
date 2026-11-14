import type { GeoTIFFImage } from "geotiff";

export const ARGOS_METADATA_TAG = 65000;

function wholeNumber(metadata: string, element: string): number | null {
  const value = new RegExp(`<${element}>\\s*(-?\\d+)\\s*</${element}>`).exec(metadata)?.[1];
  return value === undefined ? null : Number(value);
}

export function argosFocusedPlane(metadata: string): number {
  if (!metadata.includes("<Argos.Scan.Metadata>")) return 0;
  const lowest = wholeNumber(metadata, "MinZ");
  const highest = wholeNumber(metadata, "MaxZ");
  if (lowest === null || highest === null || lowest > 0 || highest < 0) return 0;
  return Math.abs(lowest);
}

export async function readArgosFocusedPlane(image: GeoTIFFImage): Promise<number> {
  if (!image.fileDirectory.hasTag(ARGOS_METADATA_TAG)) return 0;
  const value: unknown = await image.fileDirectory.loadValue(ARGOS_METADATA_TAG);
  if (typeof value === "string") return argosFocusedPlane(value);
  if (value !== null && typeof value === "object" && "length" in value) {
    const bytes = Uint8Array.from(value as ArrayLike<number>);
    return argosFocusedPlane(new TextDecoder().decode(bytes));
  }
  return 0;
}
