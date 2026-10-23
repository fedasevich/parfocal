import type { Tolerance } from "#compare.ts";

export type Codec = "lossless" | "jpeg" | "jpeg2000";

export const CODEC_TOLERANCES: Readonly<Record<Codec, Tolerance>> = {
  lossless: { maxChannelDelta: 2, maxDifferingFraction: 0.001, maxMeanChannelError: 0.25 },
  jpeg: { maxChannelDelta: 4, maxDifferingFraction: 0.005, maxMeanChannelError: 1 },
  jpeg2000: { maxChannelDelta: 6, maxDifferingFraction: 0.01, maxMeanChannelError: 1.5 },
};

export const FORMAT_CODECS = {
  synthetic: "lossless",
  "ome-tiff": "lossless",
  "ome-zarr": "lossless",
  "huron-uncompressed": "lossless",
  "svs-jpeg": "jpeg",
  "svs-jp2k": "jpeg2000",
  ndpi: "jpeg",
  mrxs: "jpeg",
  scn: "jpeg",
  bif: "jpeg",
  "philips-tiff": "jpeg",
  "generic-tiff-jpeg": "jpeg",
  "camelyon-tiff": "jpeg",
} as const satisfies Record<string, Codec>;

export type SlideFormat = keyof typeof FORMAT_CODECS;

export const SLIDE_FORMATS = Object.keys(FORMAT_CODECS) as SlideFormat[];

export function toleranceFor(format: SlideFormat): Tolerance {
  return CODEC_TOLERANCES[FORMAT_CODECS[format]];
}
