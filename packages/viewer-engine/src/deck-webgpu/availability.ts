export class WebGpuUnavailableError extends Error {
  constructor(reason: string) {
    super(`The deck.gl WebGPU route cannot start: ${reason}`);
    this.name = "WebGpuUnavailableError";
  }
}

export interface GpuLike {
  requestAdapter(): Promise<unknown>;
}

export async function assertWebGpuAvailable(gpu: GpuLike | null | undefined): Promise<void> {
  if (!gpu) throw new WebGpuUnavailableError("this browser has no navigator.gpu");
  let adapter: unknown;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    throw new WebGpuUnavailableError(
      `requesting an adapter failed, ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!adapter) throw new WebGpuUnavailableError("the browser offers no WebGPU adapter");
}
