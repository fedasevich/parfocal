import type { FrameState, RenderRequest, RenderResponse } from "./protocol.ts";
import { createRenderer, type Renderer } from "./renderer.ts";

export const mostAtlasLayers = 1024;

const intentionalLossReason = "destroyed";

export interface RenderScope {
  readonly post: (response: RenderResponse) => void;
  readonly requestFrame: (callback: () => void) => void;
  readonly gpu: GPU | undefined;
}

export interface RenderHost {
  readonly handle: (request: RenderRequest) => void;
}

interface Started {
  readonly device: GPUDevice;
  readonly canvas: OffscreenCanvas;
  readonly renderer: Renderer;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRenderHost(scope: RenderScope): RenderHost {
  let started: Started | null = null;
  let starting = false;
  let destroyed = false;
  let waiting: RenderRequest[] = [];
  let pending: { readonly id: number; readonly frame: FrameState } | null = null;
  let frameRequested = false;

  const start = async (canvas: OffscreenCanvas): Promise<void> => {
    const gpu = scope.gpu;
    if (gpu === undefined) throw new Error("this worker has no navigator.gpu");
    const adapter = await gpu.requestAdapter();
    if (adapter === null) throw new Error("the worker was offered no WebGPU adapter");
    const maxLayers = Math.min(mostAtlasLayers, adapter.limits.maxTextureArrayLayers);
    const device = await adapter.requestDevice({
      requiredLimits: { maxTextureArrayLayers: maxLayers },
    });
    if (destroyed) {
      device.destroy();
      return;
    }
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (context === null) {
      device.destroy();
      throw new Error("the canvas gave no WebGPU context");
    }
    const format = gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });
    device.addEventListener("uncapturederror", (event) => {
      event.preventDefault();
      if (!destroyed)
        scope.post({ type: "error", source: "uncaptured", message: event.error.message });
    });
    device.lost.then(
      (info) => {
        if (destroyed || info.reason === intentionalLossReason) return;
        scope.post({ type: "error", source: "device-lost", message: info.message });
      },
      () => {},
    );
    started = { device, canvas, renderer: createRenderer(device, context, format) };
    scope.post({ type: "ready", maxLayers });
  };

  const drawPending = () => {
    frameRequested = false;
    const current = started;
    const next = pending;
    pending = null;
    if (current === null || next === null || destroyed) return;
    current.renderer.draw(next.frame);
    current.device.queue.onSubmittedWorkDone().then(
      () => {
        if (!destroyed) scope.post({ type: "drawn", id: next.id });
      },
      () => {},
    );
  };

  const apply = (current: Started, request: RenderRequest) => {
    if (request.type === "resize") {
      current.canvas.width = Math.max(1, request.width);
      current.canvas.height = Math.max(1, request.height);
    }
    if (request.type === "atlas") current.renderer.setAtlas(request.tileSize, request.layers);
    if (request.type === "tile") {
      current.renderer.uploadTile(request.layer, request.width, request.height, request.rgba);
    }
    if (request.type === "set") {
      current.renderer.setOverlay(request.id, request.data, request.counts);
    }
    if (request.type === "raster") {
      current.renderer.setRaster(
        request.id,
        request.width,
        request.height,
        request.rgba,
        request.smooth,
      );
    }
    if (request.type === "pinAtlas") {
      current.renderer.setPinAtlas(request.width, request.height, request.rgba, request.frames);
    }
    if (request.type === "drop") current.renderer.dropOverlay(request.id);
    if (request.type === "frame") {
      pending = { id: request.id, frame: request.frame };
      if (frameRequested) return;
      frameRequested = true;
      scope.requestFrame(drawPending);
    }
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    waiting = [];
    pending = null;
    started?.renderer.destroy();
    started?.device.destroy();
    started = null;
  };

  const handle = (request: RenderRequest) => {
    if (destroyed) return;
    if (request.type === "destroy") {
      destroy();
      return;
    }
    if (request.type === "init") {
      if (starting) return;
      starting = true;
      start(request.canvas).then(
        () => {
          const current = started;
          const queued = waiting;
          waiting = [];
          if (current !== null) for (const next of queued) apply(current, next);
        },
        (error: unknown) => {
          if (!destroyed) scope.post({ type: "error", source: "start", message: messageOf(error) });
        },
      );
      return;
    }
    if (started === null) {
      waiting.push(request);
      return;
    }
    apply(started, request);
  };

  return { handle };
}
