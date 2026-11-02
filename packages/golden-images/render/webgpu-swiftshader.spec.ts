import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  compareFrames,
  contentProblems,
  EXACT,
  frameToBase64,
  goldenPath,
  readPng,
  swapRedAndBlue,
} from "../src/index.ts";
import { captureScreenshot, SWIFTSHADER_ARGS } from "../src/playwright.ts";
import { tile } from "./scenes.ts";

const WEBGPU_SWIFTSHADER_ARGS = [
  ...SWIFTSHADER_ARGS,
  "--enable-unsafe-webgpu",
  "--use-webgpu-adapter=swiftshader",
];

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));
const secureOrigin = "https://webgpu-probe.test/";

test.use({ launchOptions: { args: WEBGPU_SWIFTSHADER_ARGS } });

interface AdapterReport {
  readonly available: boolean;
  readonly vendor: string;
  readonly architecture: string;
  readonly fallback: boolean;
}

async function openSecurePage(page: Page): Promise<void> {
  await page.route(secureOrigin, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await page.goto(secureOrigin);
}

async function adapterReport(page: Page): Promise<AdapterReport> {
  return page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) {
      return { available: false, vendor: "", architecture: "", fallback: false };
    }
    const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };
    return {
      available: true,
      vendor: info.vendor,
      architecture: info.architecture,
      fallback: info.isFallbackAdapter === true,
    };
  });
}

async function renderTileWithWebGpu(page: Page, channelOrder: "rgb" | "bgr"): Promise<string> {
  return page.evaluate(
    async ({ base64, size, swap }) => {
      const textureBindingAndCopyDestination = 0x04 | 0x02;
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error("No WebGPU adapter");
      }
      const device = await adapter.requestDevice();
      document.body.style.margin = "0";
      const canvas = document.createElement("canvas");
      canvas.id = "webgpu-tile";
      canvas.width = size;
      canvas.height = size;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      document.body.replaceChildren(canvas);
      const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
      if (!context) {
        throw new Error("The canvas has no WebGPU context");
      }
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "opaque" });
      const texture = device.createTexture({
        size: [size, size],
        format: "rgba8unorm",
        usage: textureBindingAndCopyDestination,
      });
      device.queue.writeTexture({ texture }, bytes, { bytesPerRow: size * 4 }, [size, size]);
      const module = device.createShaderModule({
        code: `
          @group(0) @binding(0) var source: texture_2d<f32>;
          @vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
            let corners = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
            return vec4f(corners[index], 0.0, 1.0);
          }
          @fragment fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
            let texel = textureLoad(source, vec2i(position.xy), 0);
            return select(texel, vec4f(texel.b, texel.g, texel.r, texel.a), ${swap ? "true" : "false"});
          }
        `,
      });
      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vertexMain" },
        fragment: { module, entryPoint: "fragmentMain", targets: [{ format }] },
      });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: texture.createView() }],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return `#${canvas.id}`;
    },
    { base64: frameToBase64(tile), size: tile.width, swap: channelOrder === "bgr" },
  );
}

test.beforeEach(async ({ page }) => {
  await openSecurePage(page);
});

test("headless Chrome offers a SwiftShader WebGPU adapter", async ({ page }) => {
  const report = await adapterReport(page);
  console.log(`webgpu adapter ${JSON.stringify(report)}`);
  expect(report.available, "navigator.gpu.requestAdapter() returned null").toBe(true);
  expect(report.architecture).toBe("swiftshader");
});

test("a WebGPU draw of the synthetic tile matches the WebGL golden exactly", async ({ page }) => {
  const frame = await captureScreenshot(page.locator(await renderTileWithWebGpu(page, "rgb")));
  expect(contentProblems(frame)).toEqual([]);
  const golden = readPng(goldenPath(goldenDirectory, "synthetic-1x-nearest"));
  const comparison = compareFrames(frame, golden, EXACT);
  console.log(
    `webgpu vs synthetic-1x-nearest maxDelta=${comparison.maxDelta.join(",")} differing=${comparison.differingFraction}`,
  );
  expect(comparison.failures).toEqual([]);
});

test("a WebGPU draw that swaps red and blue fails the golden and is named as BGR", async ({
  page,
}) => {
  const frame = await captureScreenshot(page.locator(await renderTileWithWebGpu(page, "bgr")));
  const golden = readPng(goldenPath(goldenDirectory, "synthetic-1x-nearest"));
  const swapped = compareFrames(frame, golden, EXACT);
  expect(swapped.pass).toBe(false);
  expect(swapped.channelHint).toContain("BGR order");
  expect(compareFrames(frame, swapRedAndBlue(golden), EXACT).pass).toBe(true);
});
