import type { J2KDecoder } from "../../src/pixel-source/tiff/jpeg2000/openjpeg-glue.js";
import { loadOpenJpeg } from "../../src/pixel-source/tiff/jpeg2000/openjpeg-runtime.ts";

export interface CodecRequest {
  readonly tiles: readonly ArrayBuffer[];
  readonly repeats: number;
  readonly reduce: number;
}

export interface CodecReply {
  readonly reduce: number;
  readonly instantiateMs: number;
  readonly decodeMs: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly decompositions: number;
  readonly error: string | null;
}

interface SubResolutionDecoder extends J2KDecoder {
  readHeader(): void;
  getNumDecompositions(): number;
  decodeSubResolution(level: number, layer: number): void;
}

async function run(request: CodecRequest): Promise<CodecReply> {
  const started = performance.now();
  const module = await loadOpenJpeg();
  const instantiateMs = performance.now() - started;
  const decodeMs: number[] = [];
  let width = 0;
  let height = 0;
  let decompositions = 0;
  for (let repeat = 0; repeat < request.repeats + 1; repeat++) {
    for (const tile of request.tiles) {
      const encoded = new Uint8Array(tile);
      const decoder = new module.J2KDecoder() as SubResolutionDecoder;
      try {
        const before = performance.now();
        decoder.getEncodedBuffer(encoded.length).set(encoded);
        if (request.reduce === 0) decoder.decode();
        else decoder.decodeSubResolution(request.reduce, 0);
        const samples = decoder.getDecodedBuffer();
        const elapsed = performance.now() - before;
        if (repeat > 0) decodeMs.push(elapsed);
        const frame = decoder.getFrameInfo();
        width = frame.width;
        height = frame.height;
        decompositions = decoder.getNumDecompositions();
        if (samples.length === 0) throw new Error("The decoder returned no samples");
      } finally {
        decoder.delete();
      }
    }
  }
  return {
    reduce: request.reduce,
    instantiateMs,
    decodeMs,
    width,
    height,
    decompositions,
    error: null,
  };
}

addEventListener("message", (event: MessageEvent<CodecRequest>) => {
  run(event.data).then(
    (reply) => postMessage(reply),
    (error: unknown) =>
      postMessage({
        reduce: event.data.reduce,
        instantiateMs: 0,
        decodeMs: [],
        width: 0,
        height: 0,
        decompositions: 0,
        error: error instanceof Error ? error.message : String(error),
      } satisfies CodecReply),
  );
});
