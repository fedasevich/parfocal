export const deckDeviceProps = {
  type: "webgl",
  webgl: { antialias: false },
} as const;

export const unpickableLayerProps = { pickable: false } as const;

export type ChannelSelection = Readonly<Record<string, number>>;

const selectionsBySlide = new WeakMap<object, Map<string, readonly ChannelSelection[]>>();

export function stableSelections(
  slide: object,
  selections: readonly ChannelSelection[],
): readonly ChannelSelection[] {
  const key = JSON.stringify(selections);
  let bySelection = selectionsBySlide.get(slide);
  if (!bySelection) {
    bySelection = new Map();
    selectionsBySlide.set(slide, bySelection);
  }
  const known = bySelection.get(key);
  if (known) return known;
  const frozen = Object.freeze(selections.map((selection) => Object.freeze({ ...selection })));
  bySelection.set(key, frozen);
  return frozen;
}

export const uint8TextureFormat = "r8unorm";

const intensityHook = "fs:DECKGL_PROCESS_INTENSITY";
const stockIntensity = "intensity = apply_contrast_limits(intensity, contrastLimits);";
const uint8Intensity = "intensity = apply_contrast_limits(intensity * 255.0, contrastLimits);";

interface ShaderModuleLike {
  inject?: Record<string, unknown>;
}

interface ShaderSet {
  defines?: Record<string, unknown>;
  modules?: unknown[];
  [key: string]: unknown;
}

interface UploadedTexture {
  props?: { data?: unknown };
}

interface ChannelLayerLike {
  props: { dtype: string; interpolation: string };
  context: { device: { createTexture(props: Record<string, unknown>): UploadedTexture } };
  _isHookDefinedByExtensions(hook: string): boolean;
}

interface ChannelLayerPrototype {
  getShaders: (this: ChannelLayerLike) => ShaderSet;
  dataToTexture: (this: ChannelLayerLike, data: unknown, width: number, height: number) => unknown;
}

const patchedPrototypes = new WeakSet<object>();

function usesUint8Upload(layer: ChannelLayerLike, data?: unknown): boolean {
  if (layer.props.dtype !== "Uint8") return false;
  if (data !== undefined && !(data instanceof Uint8Array)) return false;
  return !layer._isHookDefinedByExtensions(intensityHook);
}

function rescaleIntensity(module: unknown): unknown {
  const inject = (module as ShaderModuleLike | null)?.inject;
  const code = inject?.[intensityHook];
  if (code === undefined) return module;
  if (typeof code !== "string" || !code.includes(stockIntensity)) {
    throw new Error("Viv's intensity hook changed, so the r8unorm upload cannot rescale it");
  }
  return {
    ...(module as object),
    inject: { ...inject, [intensityHook]: code.replace(stockIntensity, uint8Intensity) },
  };
}

export function installUint8TextureUpload(channelLayer: { prototype: object }): void {
  const prototype = channelLayer.prototype as ChannelLayerPrototype;
  if (patchedPrototypes.has(prototype)) return;
  patchedPrototypes.add(prototype);
  const getShaders = prototype.getShaders;
  const dataToTexture = prototype.dataToTexture;

  prototype.getShaders = function (this: ChannelLayerLike) {
    const shaders = getShaders.call(this);
    if (!usesUint8Upload(this)) return shaders;
    return {
      ...shaders,
      defines: { ...shaders.defines, SAMPLER_TYPE: "sampler2D" },
      modules: (shaders.modules ?? []).map(rescaleIntensity),
    };
  };

  prototype.dataToTexture = function (
    this: ChannelLayerLike,
    data: unknown,
    width: number,
    height: number,
  ) {
    if (!usesUint8Upload(this, data)) return dataToTexture.call(this, data, width, height);
    const filter = this.props.interpolation === "linear" ? "linear" : "nearest";
    const texture = this.context.device.createTexture({
      width,
      height,
      dimension: "2d",
      data,
      mipmaps: false,
      format: uint8TextureFormat,
      sampler: {
        minFilter: filter,
        magFilter: filter,
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      },
    });
    if (texture.props) texture.props.data = undefined;
    return texture;
  };
}
