export const tileFadeProp = "tileFade";

export const defaultTileFadeMs = 200;

export interface TileFade {
  readonly durationMs: number;
  readonly opacityOf: (content: object) => number;
  readonly active: () => boolean;
}

export function createTileFade(
  now: () => number,
  durationMs: number = defaultTileFadeMs,
): TileFade {
  const starts = new WeakMap<object, number>();
  let lastEnd = 0;

  const opacityOf = (content: object): number => {
    const current = now();
    let start = starts.get(content);
    if (start === undefined) {
      start = current;
      starts.set(content, start);
      lastEnd = Math.max(lastEnd, current + durationMs);
    }
    if (durationMs <= 0) return 1;
    return Math.min(1, Math.max(0, (current - start) / durationMs));
  };

  return { durationMs, opacityOf, active: () => now() < lastEnd };
}

interface FadingBitmapLayer {
  props: {
    image?: object | null;
    tileId?: unknown;
    [tileFadeProp]?: TileFade;
  };
  setShaderModuleProps(props: { layer: { opacity: number } }): void;
}

interface FadingBitmapPrototype {
  draw: (this: FadingBitmapLayer, params: unknown) => unknown;
}

const patchedPrototypes = new WeakSet<object>();

const layerOpacityGamma = 2.2;

export function installTileFade(bitmapLayer: { prototype: object }): void {
  const prototype = bitmapLayer.prototype as FadingBitmapPrototype;
  if (patchedPrototypes.has(prototype)) return;
  patchedPrototypes.add(prototype);
  const draw = prototype.draw;

  prototype.draw = function (this: FadingBitmapLayer, params: unknown) {
    const fade = this.props[tileFadeProp];
    const image = this.props.image;
    if (fade && this.props.tileId !== undefined && image) {
      const opacity = fade.opacityOf(image);
      if (opacity < 1) {
        this.setShaderModuleProps({ layer: { opacity: opacity ** layerOpacityGamma } });
      }
    }
    return draw.call(this, params);
  };
}
