export type InterpolationRule = "finest-nearest" | "linear";

export const defaultInterpolationRule: InterpolationRule = "finest-nearest";

export const finestTileZoom = 0;

export const interpolationRuleProp = "interpolationRule";

export interface TileSamplerProps {
  readonly minFilter: "linear";
  readonly magFilter: "nearest";
  readonly addressModeU: "clamp-to-edge";
  readonly addressModeV: "clamp-to-edge";
}

export const finestTileSampler: TileSamplerProps = {
  minFilter: "linear",
  magFilter: "nearest",
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
};

export function usesNearestMagnification(
  rule: InterpolationRule,
  tileZoom: number | undefined,
): boolean {
  return rule === "finest-nearest" && tileZoom === finestTileZoom;
}

interface TextureLike {
  setSampler(sampler: unknown): void;
}

interface DeviceLike {
  createSampler(props: TileSamplerProps): unknown;
}

interface TileBitmapLayerLike {
  props: { tileId?: { z?: number }; [interpolationRuleProp]?: InterpolationRule };
  state: { bitmapTexture?: TextureLike | null };
  context: { device: DeviceLike };
}

interface TileBitmapLayerPrototype {
  updateState: (this: TileBitmapLayerLike, params: unknown) => unknown;
}

const patchedPrototypes = new WeakSet<object>();
const samplersByDevice = new WeakMap<object, unknown>();
const styledTextures = new WeakSet<object>();

function finestSampler(device: DeviceLike): unknown {
  let sampler = samplersByDevice.get(device);
  if (sampler === undefined) {
    sampler = device.createSampler(finestTileSampler);
    samplersByDevice.set(device, sampler);
  }
  return sampler;
}

export function installTileInterpolation(bitmapLayer: { prototype: object }): void {
  const prototype = bitmapLayer.prototype as TileBitmapLayerPrototype;
  if (patchedPrototypes.has(prototype)) return;
  patchedPrototypes.add(prototype);
  const updateState = prototype.updateState;

  prototype.updateState = function (this: TileBitmapLayerLike, params: unknown) {
    const result = updateState.call(this, params);
    const texture = this.state.bitmapTexture;
    if (!texture || styledTextures.has(texture)) return result;
    styledTextures.add(texture);
    const rule = this.props[interpolationRuleProp] ?? defaultInterpolationRule;
    if (usesNearestMagnification(rule, this.props.tileId?.z)) {
      texture.setSampler(finestSampler(this.context.device));
    }
    return result;
  };
}
