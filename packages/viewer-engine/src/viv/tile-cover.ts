import type { TileFade } from "./tile-fade.ts";

export type Box = readonly [left: number, top: number, right: number, bottom: number];

const coverSlack = 1e-6;

export function boxesCover(view: Box, boxes: readonly Box[]): boolean {
  const width = view[2] - view[0];
  const height = view[3] - view[1];
  if (!(width > 0) || !(height > 0)) return false;
  let covered = 0;
  for (const box of boxes) {
    const across = Math.min(view[2], box[2]) - Math.max(view[0], box[0]);
    const down = Math.min(view[3], box[3]) - Math.max(view[1], box[1]);
    if (across > 0 && down > 0) covered += across * down;
  }
  return covered >= width * height * (1 - coverSlack);
}

export function insideSlide(view: Box, width: number, height: number): boolean {
  return view[0] >= 0 && view[1] >= 0 && view[2] <= width && view[3] <= height;
}

export interface DrawnLayer {
  readonly id: string;
  readonly isComposite: boolean;
  readonly isLoaded: boolean;
  readonly props: { readonly image?: object | null; readonly tileId?: unknown };
  readonly getSubLayers?: () => readonly DrawnLayer[];
}

export interface DrawnTile {
  readonly isLoaded: boolean;
  readonly index: { readonly z: number };
  readonly bbox: { readonly left?: number; readonly top?: number };
  readonly content?: { readonly width?: number; readonly height?: number } | null;
  readonly layers?: readonly DrawnLayer[] | null;
}

export interface TiledLayer {
  readonly state?: {
    readonly tileset?: { readonly selectedTiles?: readonly DrawnTile[] | null } | null;
  } | null;
}

type OpaqueCheck = Pick<TileFade, "opaque">;

function imagesOf(layers: readonly DrawnLayer[], images: (object | null)[]): void {
  for (const layer of layers) {
    if (!layer.isComposite) {
      images.push(layer.props.tileId !== undefined && layer.props.image ? layer.props.image : null);
      continue;
    }
    const inner = layer.getSubLayers?.() ?? [];
    if (inner.length === 0) images.push(null);
    else imagesOf(inner, images);
  }
}

function opaqueBoxOf(tile: DrawnTile, fade: OpaqueCheck | undefined): Box | null {
  const { left, top } = tile.bbox;
  const width = tile.content?.width;
  const height = tile.content?.height;
  const layers = tile.layers;
  if (!tile.isLoaded || left === undefined || top === undefined) return null;
  if (!width || !height || !layers || layers.length === 0) return null;
  if (!layers.every((layer) => layer.isLoaded)) return null;
  const images: (object | null)[] = [];
  imagesOf(layers, images);
  if (images.some((image) => image === null || (fade !== undefined && !fade.opaque(image)))) {
    return null;
  }
  const scale = 2 ** Math.round(-tile.index.z);
  return [left, top, left + width * scale, top + height * scale];
}

export function opaqueTileBoxes(tiled: TiledLayer, fade: OpaqueCheck | undefined): Box[] | null {
  const tiles = tiled.state?.tileset?.selectedTiles;
  if (!tiles || tiles.length === 0) return null;
  const level = tiles[0]?.index.z;
  const boxes: Box[] = [];
  for (const tile of tiles) {
    const box = tile.index.z === level ? opaqueBoxOf(tile, fade) : null;
    if (box === null) return null;
    boxes.push(box);
  }
  return boxes;
}
