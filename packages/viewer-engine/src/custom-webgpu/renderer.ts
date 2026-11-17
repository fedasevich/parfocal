import type { Rgba } from "../overlay/batch-types.ts";
import { bufferUsage, mapModeRead, shaderStage, textureUsage } from "./gpu-constants.ts";
import { mipChain } from "./mipmaps.ts";
import { createOverlayBuffers } from "./overlay-buffers.ts";
import {
  type FrameState,
  type FrameView,
  glyphInstanceBytes,
  type LabelDraw,
  type LayerDraw,
  labelBoxInstanceBytes,
  type PinFrames,
  pointInstanceBytes,
  type SetCounts,
  type SetDraw,
  segmentInstanceBytes,
  tileInstanceFloats,
  triangleInstanceBytes,
} from "./protocol.ts";
import {
  glyphShader,
  labelBoxShader,
  pinShader,
  pointShader,
  rasterShader,
  segmentShader,
  tileShader,
  triangleShader,
} from "./shaders.ts";

const tileInstanceBytes = tileInstanceFloats * 4;
const styleBytes = 80;
const styleStride = 256;
const stylesPerLayer = 6;
const smallestTileBuffer = 64 * tileInstanceBytes;
const thinnestLinePx = 1;
const capPart = 1;
const noStroke = [0, 0, 0, 0] as const;
const ringDepthFormat: GPUTextureFormat = "depth32float";
const bodyParts = [1, 3] as const;
const onceVertices = 12;
const timestampCount = 2;
const timestampBytes = 16;
const nanosecondsPerMs = 1e6;

export interface Renderer {
  readonly setAtlas: (tileSize: number, layers: number) => void;
  readonly uploadTile: (layer: number, width: number, height: number, rgba: ArrayBuffer) => void;
  readonly setOverlay: (id: string, data: ArrayBuffer, counts: SetCounts) => boolean;
  readonly setRaster: (
    id: string,
    width: number,
    height: number,
    rgba: ArrayBuffer,
    smooth: boolean,
  ) => void;
  readonly setPinAtlas: (
    width: number,
    height: number,
    rgba: ArrayBuffer,
    frames: PinFrames,
  ) => void;
  readonly setGlyphAtlas: (width: number, height: number, rgba: ArrayBuffer) => void;
  readonly dropOverlay: (id: string) => void;
  readonly draw: (frame: FrameState) => void;
  readonly destroy: () => void;
}

const premultipliedBlend: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};

interface Atlas {
  readonly texture: GPUTexture;
  readonly linear: GPUBindGroup;
  readonly nearest: GPUBindGroup;
}

interface Raster {
  readonly texture: GPUTexture;
  readonly group: GPUBindGroup;
}

interface StyleSlot {
  readonly halfWidth: number;
  readonly alpha: number;
  readonly colorMode: 0 | 1 | 2;
  readonly color: readonly [number, number, number, number];
  readonly dash: readonly [number, number];
  readonly innerRadius: number;
  readonly stroked: boolean;
  readonly strokeColor: readonly [number, number, number, number];
}

const plainSlot: StyleSlot = {
  halfWidth: 0,
  alpha: 1,
  colorMode: 0,
  color: [0, 0, 0, 0],
  dash: [0, 0],
  innerRadius: 0,
  stroked: false,
  strokeColor: noStroke,
};

function unit(color: Rgba): [number, number, number, number] {
  return [color[0] / 255, color[1] / 255, color[2] / 255, color[3] / 255];
}

function setSlots(set: SetDraw): readonly (StyleSlot | null)[] {
  const casingPx = set.casing?.widthPx ?? 0;
  const override = set.lineColor ? { colorMode: 1 as const, color: unit(set.lineColor) } : {};
  const outerRadius = set.pointRadiusPx + casingPx + (set.casing ? casingPx / 2 : 0);
  const casing: StyleSlot | null = set.casing
    ? {
        ...plainSlot,
        halfWidth: Math.max(thinnestLinePx, set.lineWidthPx + 2 * casingPx) / 2,
        alpha: set.alpha,
        colorMode: set.casing.followsAlpha ? 2 : 1,
        color: unit(set.casing.color),
      }
    : null;
  const line: StyleSlot = {
    ...plainSlot,
    ...override,
    halfWidth: Math.max(thinnestLinePx, set.lineWidthPx) / 2,
    alpha: set.alpha,
    dash: set.dash ?? [0, 0],
  };
  return [
    set.fillAlpha > 0 ? { ...plainSlot, alpha: set.fillAlpha } : null,
    casing,
    casing ? { ...casing, innerRadius: capPart } : null,
    line,
    { ...line, innerRadius: capPart },
    {
      ...plainSlot,
      ...override,
      halfWidth: outerRadius,
      alpha: set.alpha,
      innerRadius: outerRadius - casingPx,
      stroked: set.casing !== null,
      strokeColor: set.casing ? unit(set.casing.color) : noStroke,
    },
  ];
}

interface PinAtlas extends IconTexture {
  readonly frames: PinFrames;
}

function pinSlot(sizePx: number, alpha: number, atlas: PinAtlas): StyleSlot {
  const { frames } = atlas;
  return {
    ...plainSlot,
    halfWidth: sizePx,
    alpha,
    color: [frames.width, frames.height, frames.anchorX, frames.anchorY],
    dash: [frames.openX, frames.resolvedX],
    innerRadius: frames.y,
    strokeColor: [atlas.width, atlas.height, 0, 0],
  };
}

interface IconTexture {
  readonly texture: GPUTexture;
  readonly group: GPUBindGroup;
  readonly width: number;
  readonly height: number;
}

function labelSlots(layer: LabelDraw, glyphs: IconTexture | null): readonly (StyleSlot | null)[] {
  return [
    { ...plainSlot, halfWidth: layer.borderPx, alpha: layer.alpha, color: unit(layer.fill) },
    glyphs
      ? {
          ...plainSlot,
          alpha: layer.alpha,
          color: unit(layer.text),
          strokeColor: [glyphs.width, glyphs.height, 0, 0],
        }
      : null,
  ];
}

function layerSlots(
  layer: LayerDraw,
  pins: PinAtlas | null,
  glyphs: IconTexture | null,
): readonly (StyleSlot | null)[] {
  if (layer.kind === "set") return setSlots(layer);
  if (layer.kind === "labels") return labelSlots(layer, glyphs);
  if (layer.kind === "pins") return [pins ? pinSlot(layer.sizePx, layer.alpha, pins) : null];
  const { x, y, width, height } = layer.area;
  return [{ ...plainSlot, alpha: layer.alpha, color: [x, y, width, height] }];
}

function writeStyle(into: Float32Array, at: number, view: FrameView, slot: StyleSlot): void {
  into.set(
    [
      view.x,
      view.y,
      view.scale,
      slot.halfWidth,
      view.width,
      view.height,
      slot.alpha,
      slot.colorMode,
      ...slot.color,
      ...slot.dash,
      slot.innerRadius,
      slot.stroked ? 1 : 0,
      ...slot.strokeColor,
    ],
    at,
  );
}

export function createRenderer(
  device: GPUDevice,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
  onGpuTime: ((ms: number) => void) | null = null,
): Renderer {
  const timing =
    onGpuTime === null
      ? null
      : {
          report: onGpuTime,
          querySet: device.createQuerySet({ type: "timestamp", count: timestampCount }),
          resolved: device.createBuffer({
            size: timestampBytes,
            usage: bufferUsage.queryResolve | bufferUsage.copySrc,
          }),
        };
  const target: GPUColorTargetState = { format, blend: premultipliedBlend };

  const tileModule = device.createShaderModule({ code: tileShader });
  const tilePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: tileModule,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: tileInstanceBytes,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 16, format: "float32x2" },
            { shaderLocation: 2, offset: 24, format: "float32x2" },
          ],
        },
      ],
    },
    fragment: { module: tileModule, entryPoint: "fs", targets: [target] },
    primitive: { topology: "triangle-strip" },
  });

  const styleLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: shaderStage.vertex | shaderStage.fragment,
        buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: styleBytes },
      },
    ],
  });
  const rasterLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: shaderStage.fragment, texture: {} },
      { binding: 1, visibility: shaderStage.fragment, sampler: {} },
    ],
  });
  const shapeLayout = device.createPipelineLayout({ bindGroupLayouts: [styleLayout] });

  const shapePipeline = (
    code: string,
    topology: GPUPrimitiveTopology,
    arrayStride: number,
    attributes: GPUVertexAttribute[],
  ): GPURenderPipeline => {
    const module = device.createShaderModule({ code });
    return device.createRenderPipeline({
      layout: shapeLayout,
      vertex: {
        module,
        entryPoint: "vs",
        buffers: [{ arrayStride, stepMode: "instance", attributes }],
      },
      fragment: { module, entryPoint: "fs", targets: [target] },
      primitive: { topology },
    });
  };

  const trianglePipeline = shapePipeline(triangleShader, "triangle-list", triangleInstanceBytes, [
    { shaderLocation: 0, offset: 0, format: "float32x2" },
    { shaderLocation: 1, offset: 8, format: "float32x2" },
    { shaderLocation: 2, offset: 16, format: "float32x2" },
    { shaderLocation: 3, offset: 24, format: "unorm8x4" },
  ]);
  const segmentAttributes: GPUVertexAttribute[] = [
    { shaderLocation: 0, offset: 0, format: "float32x2" },
    { shaderLocation: 1, offset: 8, format: "float32x2" },
    { shaderLocation: 2, offset: 16, format: "float32" },
    { shaderLocation: 3, offset: 20, format: "unorm8x4" },
  ];
  const segmentPipeline = shapePipeline(
    segmentShader,
    "triangle-strip",
    segmentInstanceBytes,
    segmentAttributes,
  );
  const onceModule = device.createShaderModule({ code: segmentShader });
  const segmentOncePipeline = device.createRenderPipeline({
    layout: shapeLayout,
    vertex: {
      module: onceModule,
      entryPoint: "vsOnce",
      buffers: [
        {
          arrayStride: segmentInstanceBytes,
          stepMode: "instance",
          attributes: [...segmentAttributes, { shaderLocation: 4, offset: 24, format: "uint32" }],
        },
      ],
    },
    fragment: { module: onceModule, entryPoint: "fsOnce", targets: [target] },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: ringDepthFormat,
      depthWriteEnabled: true,
      depthCompare: "not-equal",
    },
  });
  const pointPipeline = shapePipeline(pointShader, "triangle-strip", pointInstanceBytes, [
    { shaderLocation: 0, offset: 0, format: "float32x2" },
    { shaderLocation: 1, offset: 8, format: "unorm8x4" },
  ]);

  const rasterModule = device.createShaderModule({ code: rasterShader });
  const rasterPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [styleLayout, rasterLayout] }),
    vertex: { module: rasterModule, entryPoint: "vs" },
    fragment: { module: rasterModule, entryPoint: "fs", targets: [target] },
    primitive: { topology: "triangle-strip" },
  });

  const pinModule = device.createShaderModule({ code: pinShader });
  const pinPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [styleLayout, rasterLayout] }),
    vertex: {
      module: pinModule,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: pointInstanceBytes,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 8, format: "float32" },
          ],
        },
      ],
    },
    fragment: { module: pinModule, entryPoint: "fs", targets: [target] },
    primitive: { topology: "triangle-strip" },
  });
  const labelBoxPipeline = shapePipeline(labelBoxShader, "triangle-strip", labelBoxInstanceBytes, [
    { shaderLocation: 0, offset: 0, format: "float32x2" },
    { shaderLocation: 1, offset: 8, format: "float32x2" },
    { shaderLocation: 2, offset: 16, format: "float32x2" },
    { shaderLocation: 3, offset: 24, format: "unorm8x4" },
  ]);
  const glyphModule = device.createShaderModule({ code: glyphShader });
  const glyphPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [styleLayout, rasterLayout] }),
    vertex: {
      module: glyphModule,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: glyphInstanceBytes,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 8, format: "float32x2" },
            { shaderLocation: 2, offset: 16, format: "float32x2" },
            { shaderLocation: 3, offset: 24, format: "float32x4" },
          ],
        },
      ],
    },
    fragment: { module: glyphModule, entryPoint: "fs", targets: [target] },
    primitive: { topology: "triangle-strip" },
  });
  const mipmapSampler = device.createSampler({
    minFilter: "linear",
    magFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  const frameUniform = device.createBuffer({
    size: 16,
    usage: bufferUsage.uniform | bufferUsage.copyDst,
  });
  const sampler = (filter: GPUFilterMode): GPUSampler =>
    device.createSampler({
      minFilter: filter,
      magFilter: filter,
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
  const linearSampler = sampler("linear");
  const nearestSampler = sampler("nearest");

  const overlays = createOverlayBuffers<GPUBuffer>(
    device,
    bufferUsage.vertex | bufferUsage.copyDst,
    device.limits.maxBufferSize,
  );
  const rasters = new Map<string, Raster>();

  let atlas: Atlas | null = null;
  let pinAtlas: PinAtlas | null = null;
  let glyphAtlas: IconTexture | null = null;
  let ringDepth: GPUTexture | null = null;
  let tileBuffer: GPUBuffer | null = null;
  let tileCapacity = 0;
  let styleBuffer: GPUBuffer | null = null;
  let styleGroup: GPUBindGroup | null = null;
  let styleCapacity = 0;

  const atlasGroup = (view: GPUTextureView, tileSampler: GPUSampler): GPUBindGroup =>
    device.createBindGroup({
      layout: tilePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: frameUniform } },
        { binding: 1, resource: view },
        { binding: 2, resource: tileSampler },
      ],
    });

  const setAtlas = (tileSize: number, layers: number) => {
    atlas?.texture.destroy();
    const texture = device.createTexture({
      size: { width: tileSize, height: tileSize, depthOrArrayLayers: layers },
      format: "rgba8unorm",
      usage: textureUsage.textureBinding | textureUsage.copyDst,
    });
    const view = texture.createView({ dimension: "2d-array" });
    atlas = {
      texture,
      linear: atlasGroup(view, linearSampler),
      nearest: atlasGroup(view, nearestSampler),
    };
  };

  const dropRaster = (id: string) => {
    rasters.get(id)?.texture.destroy();
    rasters.delete(id);
  };

  const setRaster: Renderer["setRaster"] = (id, width, height, rgba, smooth) => {
    dropRaster(id);
    const texture = device.createTexture({
      size: { width, height },
      format: "rgba8unorm",
      usage: textureUsage.textureBinding | textureUsage.copyDst,
    });
    device.queue.writeTexture(
      { texture },
      rgba,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { width, height },
    );
    rasters.set(id, {
      texture,
      group: device.createBindGroup({
        layout: rasterLayout,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: smooth ? linearSampler : nearestSampler },
        ],
      }),
    });
  };

  const iconTexture = (width: number, height: number, rgba: ArrayBuffer): IconTexture => {
    const levels = mipChain({ width, height, rgba: new Uint8Array(rgba) });
    const texture = device.createTexture({
      size: { width, height },
      format: "rgba8unorm",
      mipLevelCount: levels.length,
      usage: textureUsage.textureBinding | textureUsage.copyDst,
    });
    levels.forEach((level, mipLevel) => {
      device.queue.writeTexture(
        { texture, mipLevel },
        level.rgba,
        { bytesPerRow: level.width * 4, rowsPerImage: level.height },
        { width: level.width, height: level.height },
      );
    });
    return {
      texture,
      width,
      height,
      group: device.createBindGroup({
        layout: rasterLayout,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: mipmapSampler },
        ],
      }),
    };
  };

  const setPinAtlas: Renderer["setPinAtlas"] = (width, height, rgba, frames) => {
    pinAtlas?.texture.destroy();
    pinAtlas = { ...iconTexture(width, height, rgba), frames };
  };

  const setGlyphAtlas: Renderer["setGlyphAtlas"] = (width, height, rgba) => {
    glyphAtlas?.texture.destroy();
    glyphAtlas = iconTexture(width, height, rgba);
  };

  const tileInstancesBuffer = (bytes: number): GPUBuffer => {
    if (tileBuffer !== null && tileCapacity >= bytes) return tileBuffer;
    tileBuffer?.destroy();
    tileCapacity = Math.max(smallestTileBuffer, tileCapacity);
    while (tileCapacity < bytes) tileCapacity *= 2;
    tileBuffer = device.createBuffer({
      size: tileCapacity,
      usage: bufferUsage.vertex | bufferUsage.copyDst,
    });
    return tileBuffer;
  };

  const stylesFor = (layers: number): { buffer: GPUBuffer; group: GPUBindGroup } => {
    const bytes = Math.max(1, layers) * stylesPerLayer * styleStride;
    if (styleBuffer === null || styleGroup === null || styleCapacity < bytes) {
      styleBuffer?.destroy();
      styleCapacity = bytes;
      styleBuffer = device.createBuffer({
        size: bytes,
        usage: bufferUsage.uniform | bufferUsage.copyDst,
      });
      styleGroup = device.createBindGroup({
        layout: styleLayout,
        entries: [{ binding: 0, resource: { buffer: styleBuffer, size: styleBytes } }],
      });
    }
    return { buffer: styleBuffer, group: styleGroup };
  };

  const draw = (frame: FrameState) => {
    const tint = frame.tint;
    device.queue.writeBuffer(frameUniform, 0, new Float32Array([tint, tint, tint, 1]));
    const tiles = atlas !== null && frame.tileCount > 0 ? atlas : null;
    const instances = tiles ? tileInstancesBuffer(frame.tileCount * tileInstanceBytes) : null;
    if (instances) {
      device.queue.writeBuffer(instances, 0, frame.tiles, 0, frame.tileCount * tileInstanceBytes);
    }

    const pins = pinAtlas;
    const drawable = frame.layers.filter((layer) => {
      if (layer.kind === "raster") return rasters.has(layer.id);
      if (layer.kind === "pins") return pins !== null && overlays.get(layer.id) !== undefined;
      return overlays.get(layer.id) !== undefined;
    });
    const styles = drawable.length > 0 ? stylesFor(drawable.length) : null;
    const glyphs = glyphAtlas;
    const slots = drawable.map((layer) => layerSlots(layer, pins, glyphs));
    if (styles) {
      const values = new Float32Array((drawable.length * stylesPerLayer * styleStride) / 4);
      slots.forEach((parts, index) => {
        parts.forEach((slot, part) => {
          if (slot === null) return;
          writeStyle(values, ((index * stylesPerLayer + part) * styleStride) / 4, frame.view, slot);
        });
      });
      device.queue.writeBuffer(styles.buffer, 0, values);
    }

    const timed =
      timing !== null &&
      !drawable.some(
        (layer) =>
          layer.kind === "set" && layer.alpha < 1 && (overlays.get(layer.id)?.segments ?? 0) > 0,
      );
    const encoder = device.createCommandEncoder();
    const frameTexture = context.getCurrentTexture();
    const frameView = frameTexture.createView();
    let cleared = false;
    const beginPass = (depth: GPUTextureView | null): GPURenderPassEncoder => {
      const loadOp: GPULoadOp = cleared ? "load" : "clear";
      cleared = true;
      return encoder.beginRenderPass({
        colorAttachments: [
          { view: frameView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp, storeOp: "store" },
        ],
        ...(timed && timing
          ? {
              timestampWrites: {
                querySet: timing.querySet,
                beginningOfPassWriteIndex: 0,
                endOfPassWriteIndex: 1,
              },
            }
          : {}),
        ...(depth
          ? {
              depthStencilAttachment: {
                view: depth,
                depthClearValue: 0,
                depthLoadOp: "clear" as const,
                depthStoreOp: "discard" as const,
              },
            }
          : {}),
      });
    };
    const ringDepthView = (): GPUTextureView => {
      const { width, height } = frameTexture;
      if (ringDepth === null || ringDepth.width !== width || ringDepth.height !== height) {
        ringDepth?.destroy();
        ringDepth = device.createTexture({
          size: { width, height },
          format: ringDepthFormat,
          usage: textureUsage.renderAttachment,
        });
      }
      return ringDepth.createView();
    };
    let pass = beginPass(null);
    if (tiles && instances) {
      pass.setPipeline(tilePipeline);
      pass.setBindGroup(0, frame.nearest ? tiles.nearest : tiles.linear);
      pass.setVertexBuffer(0, instances);
      pass.draw(4, frame.tileCount);
    }
    if (styles) {
      drawable.forEach((layer, index) => {
        const offsetOf = (part: number) => (index * stylesPerLayer + part) * styleStride;
        if (layer.kind === "raster") {
          const raster = rasters.get(layer.id);
          if (raster === undefined) return;
          pass.setPipeline(rasterPipeline);
          pass.setBindGroup(0, styles.group, [offsetOf(0)]);
          pass.setBindGroup(1, raster.group);
          pass.draw(4);
          return;
        }
        const stored = overlays.get(layer.id);
        if (stored === undefined) return;
        if (layer.kind === "pins") {
          if (pins === null || stored.points === 0) return;
          pass.setPipeline(pinPipeline);
          pass.setBindGroup(0, styles.group, [offsetOf(0)]);
          pass.setBindGroup(1, pins.group);
          pass.setVertexBuffer(0, stored.buffer, stored.pointOffset);
          pass.draw(4, stored.points);
          return;
        }
        if (layer.kind === "labels") {
          if (stored.points > 0) {
            pass.setPipeline(labelBoxPipeline);
            pass.setBindGroup(0, styles.group, [offsetOf(0)]);
            pass.setVertexBuffer(0, stored.buffer, stored.pointOffset);
            pass.draw(4, stored.points);
          }
          const text = overlays.get(layer.glyphsId);
          if (glyphs === null || text === undefined || text.points === 0) return;
          pass.setPipeline(glyphPipeline);
          pass.setBindGroup(0, styles.group, [offsetOf(1)]);
          pass.setBindGroup(1, glyphs.group);
          pass.setVertexBuffer(0, text.buffer, text.pointOffset);
          pass.draw(4, text.points);
          return;
        }
        const parts = slots[index] ?? [];
        const [fill] = parts;
        const point = parts[5];
        const ranges = layer.kind === "set" ? layer.ranges : undefined;
        const drawRanges = (vertices: number, kept: readonly number[], first = 0) => {
          for (let at = 0; at + 1 < kept.length; at += 2) {
            const from = kept[at] ?? 0;
            const to = kept[at + 1] ?? 0;
            if (to > from) pass.draw(vertices, to - from, 0, first + from);
          }
        };
        const segmentRanges = ranges?.segments ?? [0, stored.segments];
        if (fill && stored.triangles > 0) {
          pass.setPipeline(trianglePipeline);
          pass.setBindGroup(0, styles.group, [offsetOf(0)]);
          pass.setVertexBuffer(0, stored.buffer, 0);
          drawRanges(3, ranges?.triangles ?? [0, stored.triangles]);
        }
        if (stored.segments > 0 && layer.alpha < 1) {
          const repeatRanges = ranges?.repeats ?? [0, stored.repeats ?? 0];
          for (const part of bodyParts) {
            if (!parts[part]) continue;
            pass.end();
            pass = beginPass(ringDepthView());
            pass.setPipeline(segmentOncePipeline);
            pass.setBindGroup(0, styles.group, [offsetOf(part)]);
            pass.setVertexBuffer(0, stored.buffer, stored.segmentOffset);
            drawRanges(onceVertices, segmentRanges);
            drawRanges(onceVertices, repeatRanges, stored.segments);
            pass.end();
            pass = beginPass(null);
          }
        } else if (stored.segments > 0) {
          pass.setPipeline(segmentPipeline);
          pass.setVertexBuffer(0, stored.buffer, stored.segmentOffset);
          for (let part = 1; part <= 4; part++) {
            if (!parts[part]) continue;
            pass.setBindGroup(0, styles.group, [offsetOf(part)]);
            drawRanges(4, segmentRanges);
          }
        }
        if (point && stored.points > 0) {
          pass.setPipeline(pointPipeline);
          pass.setBindGroup(0, styles.group, [offsetOf(5)]);
          pass.setVertexBuffer(0, stored.buffer, stored.pointOffset);
          drawRanges(4, ranges?.points ?? [0, stored.points]);
        }
      });
    }
    pass.end();
    let stamps: GPUBuffer | null = null;
    if (timed && timing) {
      encoder.resolveQuerySet(timing.querySet, 0, timestampCount, timing.resolved, 0);
      stamps = device.createBuffer({
        size: timestampBytes,
        usage: bufferUsage.mapRead | bufferUsage.copyDst,
      });
      encoder.copyBufferToBuffer(timing.resolved, 0, stamps, 0, timestampBytes);
    }
    device.queue.submit([encoder.finish()]);
    if (stamps && timing) {
      const buffer = stamps;
      buffer.mapAsync(mapModeRead).then(
        () => {
          const [from = 0n, to = 0n] = new BigUint64Array(buffer.getMappedRange());
          buffer.unmap();
          buffer.destroy();
          timing.report(Number(to - from) / nanosecondsPerMs);
        },
        () => {},
      );
    }
  };

  return {
    setAtlas,
    uploadTile: (layer, width, height, rgba) => {
      if (atlas === null) return;
      device.queue.writeTexture(
        { texture: atlas.texture, origin: { x: 0, y: 0, z: layer } },
        rgba,
        { bytesPerRow: width * 4, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 },
      );
    },
    setOverlay: overlays.set,
    setRaster,
    setPinAtlas,
    setGlyphAtlas,
    dropOverlay: (id) => {
      overlays.drop(id);
      dropRaster(id);
    },
    draw,
    destroy: () => {
      atlas?.texture.destroy();
      atlas = null;
      pinAtlas?.texture.destroy();
      pinAtlas = null;
      glyphAtlas?.texture.destroy();
      glyphAtlas = null;
      ringDepth?.destroy();
      ringDepth = null;
      timing?.querySet.destroy();
      timing?.resolved.destroy();
      tileBuffer?.destroy();
      styleBuffer?.destroy();
      frameUniform.destroy();
      overlays.destroy();
      for (const id of [...rasters.keys()]) dropRaster(id);
    },
  };
}
