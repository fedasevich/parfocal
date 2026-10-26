import type { ChannelInfo } from "../types.ts";

const omeColour = (value: number): readonly [number, number, number] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
];

const fallbackColours: readonly (readonly [number, number, number])[] = [
  [0, 0, 255],
  [0, 255, 0],
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
  [255, 255, 255],
];

function attribute(element: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(element)?.[1];
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function parseOmeChannels(description: string): ChannelInfo[] | null {
  const pixels = /<(?:\w+:)?Pixels\b[^>]*>/.exec(description)?.[0];
  if (pixels === undefined) return null;
  const sizeC = Number(attribute(pixels, "SizeC") ?? 1);
  const sizeZ = Number(attribute(pixels, "SizeZ") ?? 1);
  const sizeT = Number(attribute(pixels, "SizeT") ?? 1);
  const order = attribute(pixels, "DimensionOrder") ?? "XYZCT";
  if (!Number.isInteger(sizeC) || sizeC < 2) return null;
  const channelFastest = order.startsWith("XYC");
  if (sizeZ * sizeT !== 1 && !channelFastest) return null;
  const elements = [...description.matchAll(/<(?:\w+:)?Channel\b[^>]*>/g)].map((match) => match[0]);
  if (elements.some((element) => Number(attribute(element, "SamplesPerPixel") ?? 1) !== 1))
    return null;
  return Array.from({ length: sizeC }, (_, index): ChannelInfo => {
    const element = elements[index] ?? "";
    const name = attribute(element, "Name");
    const colour = attribute(element, "Color");
    return {
      name: name === undefined ? `Channel ${index + 1}` : decodeEntities(name),
      color:
        colour === undefined
          ? (fallbackColours[index % fallbackColours.length] ?? null)
          : omeColour(Number(colour)),
      window: null,
    };
  });
}
