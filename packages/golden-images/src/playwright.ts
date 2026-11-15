import type { Locator, Page } from "@playwright/test";
import { createFrame, type Frame, flipRows, frameFromBase64 } from "#frame.ts";
import { decodePng } from "#png.ts";

export const SWIFTSHADER_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

export const WEBGPU_SWIFTSHADER_ARGS = [
  ...SWIFTSHADER_ARGS,
  "--enable-unsafe-webgpu",
  "--use-webgpu-adapter=swiftshader",
  "--use-vulkan=swiftshader",
  "--enable-features=Vulkan",
];

export const HARDWARE_GPU_ARGS = [
  "--enable-unsafe-webgpu",
  "--ignore-gpu-blocklist",
  "--enable-gpu-rasterization",
  "--force-color-profile=srgb",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
];

export const onHardwareGpu = (): boolean => process.env["PARFOCAL_GPU"] === "hardware";

export interface GpuLaunch {
  readonly headless?: boolean;
  readonly launchOptions: { readonly args: string[] };
}

export function gpuLaunch(softwareArgs: readonly string[]): GpuLaunch {
  return onHardwareGpu()
    ? { headless: false, launchOptions: { args: [...HARDWARE_GPU_ARGS] } }
    : { launchOptions: { args: [...softwareArgs] } };
}

export async function assertGpuMode(page: Page): Promise<string> {
  if (!onHardwareGpu()) return assertSwiftShader(page);
  const renderer = await webglRendererName(page);
  if (renderer.includes("SwiftShader") || renderer === "no WebGL2") {
    throw new Error(
      `PARFOCAL_GPU=hardware asks for the hardware GPU, but WebGL runs on "${renderer}"`,
    );
  }
  return renderer;
}

export async function webglRendererName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) {
      return "no WebGL2";
    }
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
}

export async function assertSwiftShader(page: Page): Promise<string> {
  const renderer = await webglRendererName(page);
  if (!renderer.includes("SwiftShader")) {
    throw new Error(
      `Golden images are compared on SwiftShader only, but WebGL runs on "${renderer}". Launch Chrome with ${SWIFTSHADER_ARGS.join(" ")}`,
    );
  }
  return renderer;
}

export async function captureWebglCanvas(page: Page, selector: string): Promise<Frame> {
  const captured = await page.evaluate((query) => {
    const canvas = document.querySelector(query);
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error(`No canvas matches ${query}`);
    }
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) {
      throw new Error(`${query} has no WebGL context`);
    }
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let binary = "";
    for (let start = 0; start < pixels.length; start += 0x8000) {
      binary += String.fromCharCode(...pixels.subarray(start, start + 0x8000));
    }
    return { width, height, base64: btoa(binary) };
  }, selector);
  return flipRows(frameFromBase64(captured.width, captured.height, captured.base64));
}

export async function captureScreenshot(locator: Locator): Promise<Frame> {
  const frame = decodePng(await locator.screenshot({ type: "png", animations: "disabled" }));
  return createFrame(frame.width, frame.height, frame.data);
}
