export type MinimapSize = "full" | "travel" | "compact" | "pip";

export type MapRect = [number, number, number, number];

const mapWidths: Record<MinimapSize, number> = { full: 196, travel: 250, compact: 150, pip: 92 };

export function minimapBox(size: MinimapSize, extent: MapRect) {
  let width = mapWidths[size];
  let height = (width * extent[3]) / extent[2];
  const maxHeight = size === "pip" ? 92 : width * 1.25;
  if (height > maxHeight) {
    width = (maxHeight * extent[2]) / extent[3];
    height = maxHeight;
  }
  const chrome = size === "pip" ? 12 : size === "compact" ? 34 : 56;
  return { mapWidth: width, mapHeight: height, width: width + 12, height: height + chrome };
}

export type MinimapSetting = "useful" | "always" | "never";

export function shownMinimap(
  setting: MinimapSetting,
  mode: MinimapSize | "hidden",
): MinimapSize | null {
  if (setting === "never") return null;
  if (mode === "hidden") return setting === "always" ? "full" : null;
  return mode;
}
