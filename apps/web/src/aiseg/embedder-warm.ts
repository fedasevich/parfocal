import { Device, warmSlideEmbedder } from "@parfocal/api-client";

export interface GpuProbe {
  requestAdapter(): Promise<unknown>;
}

export type WarmRequest = (slideId: string, device: Device) => Promise<unknown>;

export interface EmbedderWarmOptions {
  readonly gpu?: GpuProbe | undefined;
  readonly warm?: WarmRequest;
}

const requestWarm: WarmRequest = (slideId, device) => warmSlideEmbedder(slideId, { device });

function browserGpu(): GpuProbe | undefined {
  return (globalThis.navigator as { gpu?: GpuProbe } | undefined)?.gpu;
}

export async function deviceSpeed(gpu: GpuProbe | undefined): Promise<Device> {
  if (gpu === undefined) return Device.slow;
  try {
    return (await gpu.requestAdapter()) === null ? Device.slow : Device.fast;
  } catch {
    return Device.slow;
  }
}

export async function warmEmbedderIfSlow(
  slideId: string,
  options: EmbedderWarmOptions = {},
): Promise<boolean> {
  const device = await deviceSpeed("gpu" in options ? options.gpu : browserGpu());
  if (device !== Device.slow) return false;
  await (options.warm ?? requestWarm)(slideId, device).catch(() => undefined);
  return true;
}
