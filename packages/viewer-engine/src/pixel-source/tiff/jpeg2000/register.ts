import { addDecoder } from "geotiff";

export const aperioJpeg2000YCbCr = 33003;
export const aperioJpeg2000Rgb = 33005;

export const jpeg2000Compressions: ReadonlySet<number> = new Set([
  aperioJpeg2000YCbCr,
  aperioJpeg2000Rgb,
]);

type ParameterFn = NonNullable<Parameters<typeof addDecoder>[2]>;

const decoderParameters: ParameterFn = async (directory) => {
  const tiled = directory.hasTag("TileWidth");
  return {
    tileWidth: Number(await directory.loadValue(tiled ? "TileWidth" : "ImageWidth")),
    tileHeight: Number(await directory.loadValue(tiled ? "TileLength" : "RowsPerStrip")),
    planarConfiguration: Number((await directory.loadValue("PlanarConfiguration")) ?? 1),
    bitsPerSample: Array.from((await directory.loadValue("BitsPerSample")) as ArrayLike<number>),
    predictor: 1,
    samplesPerPixel: Number((await directory.loadValue("SamplesPerPixel")) ?? 3),
  };
};

let registered = false;

export function registerJpeg2000Decoders(): void {
  if (registered) return;
  registered = true;
  addDecoder(
    [...jpeg2000Compressions],
    () => import("./jpeg2000-decoder.ts").then((module) => module.default),
    decoderParameters,
    false,
  );
}
