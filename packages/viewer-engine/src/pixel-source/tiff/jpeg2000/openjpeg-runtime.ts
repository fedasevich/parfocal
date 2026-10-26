import type { J2KDecoder, OpenJpegModule } from "./openjpeg-glue.js";

let loading: Promise<OpenJpegModule> | null = null;
let loads = 0;

const insideBrowser = "window" in globalThis || "importScripts" in globalThis;

export function openJpegLoadCount(): number {
  return loads;
}

async function instantiate(): Promise<OpenJpegModule> {
  loads++;
  const glue = await import("./openjpeg-glue.js");
  const wasmUrl = insideBrowser ? (await import("./openjpeg-wasm-url.js")).default : null;
  return glue.default({
    print: () => undefined,
    printErr: () => undefined,
    ...(wasmUrl === null ? {} : { locateFile: () => wasmUrl }),
  });
}

export function loadOpenJpeg(): Promise<OpenJpegModule> {
  loading ??= instantiate().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export interface DecodedCodestream {
  readonly width: number;
  readonly height: number;
  readonly bitsPerSample: number;
  readonly componentCount: number;
  readonly samples: Uint8Array<ArrayBuffer>;
}

export async function decodeCodestream(encoded: Uint8Array): Promise<DecodedCodestream> {
  const module = await loadOpenJpeg();
  const decoder: J2KDecoder = new module.J2KDecoder();
  try {
    decoder.getEncodedBuffer(encoded.length).set(encoded);
    decoder.decode();
    const frame = decoder.getFrameInfo();
    return {
      width: frame.width,
      height: frame.height,
      bitsPerSample: frame.bitsPerSample,
      componentCount: frame.componentCount,
      samples: new Uint8Array(decoder.getDecodedBuffer()),
    };
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) loading = null;
    throw error;
  } finally {
    decoder.delete();
  }
}
