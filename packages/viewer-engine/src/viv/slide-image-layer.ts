import type { CompositeLayer, FilterContext, Layer } from "@deck.gl/core";
import { MultiscaleImageLayer } from "@hms-dbmi/viv";
import {
  type Box,
  boxesCover,
  type DrawnLayer,
  insideSlide,
  opaqueTileBoxes,
  type TiledLayer,
} from "./tile-cover.ts";
import { type TileFade, tileFadeProp } from "./tile-fade.ts";

export const backgroundLayerPrefix = "Background-Image-";
export const tiledLayerPrefix = "Tiled-Image-";

interface SlideImageInternals {
  readonly props: {
    readonly loader: readonly { readonly shape: readonly number[] }[];
    readonly opacity?: number;
    readonly [tileFadeProp]?: TileFade;
  };
  getSubLayers(): readonly (DrawnLayer & TiledLayer)[];
}

const VivSlideLayer = MultiscaleImageLayer as unknown as new (
  ...props: object[]
) => CompositeLayer & { renderLayers(): Layer[] };

export class SlideImageLayer extends VivSlideLayer {
  static layerName = "SlideImageLayer";

  override filterSubLayer(context: FilterContext): boolean {
    if (!context.layer.id.startsWith(backgroundLayerPrefix)) return true;
    const self = this as unknown as SlideImageInternals;
    const [height, width] = self.props.loader[0]?.shape ?? [];
    if (height === undefined || width === undefined || (self.props.opacity ?? 1) < 1) return true;
    const bounds = context.viewport.getBounds();
    const view: Box = [bounds[0] ?? 0, bounds[1] ?? 0, bounds[2] ?? 0, bounds[3] ?? 0];
    if (!insideSlide(view, width, height)) return true;
    const tiled = self.getSubLayers().find((layer) => layer.id.startsWith(tiledLayerPrefix));
    const boxes = tiled ? opaqueTileBoxes(tiled, self.props[tileFadeProp]) : null;
    return boxes === null || !boxesCover(view, boxes);
  }
}
