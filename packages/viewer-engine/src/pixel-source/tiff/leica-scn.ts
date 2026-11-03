export class MultiRegionScnError extends Error {
  readonly regions: number;

  constructor(regions: number) {
    super(`The Leica SCN file holds ${regions} main images, and multi-region slides are refused`);
    this.name = "MultiRegionScnError";
    this.regions = regions;
  }
}

interface ScnDimension {
  readonly r: number;
  readonly ifd: number;
}

interface ScnImage {
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly dimensions: readonly ScnDimension[];
}

function numberAttribute(element: string, name: string): number | undefined {
  const value = new RegExp(`\\s${name}="([^"]*)"`).exec(element)?.[1];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isMainPlane(element: string): boolean {
  return (numberAttribute(element, "c") ?? 0) === 0 && (numberAttribute(element, "z") ?? 0) === 0;
}

function parseImage(body: string): ScnImage | null {
  const view = /<view\b[^>]*>/.exec(body)?.[0];
  if (view === undefined) return null;
  const viewWidth = numberAttribute(view, "sizeX");
  const viewHeight = numberAttribute(view, "sizeY");
  if (viewWidth === undefined || viewHeight === undefined) return null;
  const dimensions: ScnDimension[] = [];
  for (const [element] of body.matchAll(/<dimension\b[^>]*>/g)) {
    const r = numberAttribute(element, "r");
    const ifd = numberAttribute(element, "ifd");
    if (r !== undefined && ifd !== undefined && isMainPlane(element)) dimensions.push({ r, ifd });
  }
  return { viewWidth, viewHeight, dimensions };
}

export function scnMainPyramid(description: string): number[] | null {
  if (!/<scn\b[^>]*leica-microsystems\.com\/scn/.test(description)) return null;
  const collection = /<collection\b[^>]*>/.exec(description)?.[0];
  if (collection === undefined) return null;
  const width = numberAttribute(collection, "sizeX");
  const height = numberAttribute(collection, "sizeY");
  const images = Array.from(description.matchAll(/<image\b[^>]*>([\s\S]*?)<\/image>/g), (match) =>
    parseImage(match[1] ?? ""),
  ).filter((image): image is ScnImage => image !== null);
  const main = images.filter((image) => image.viewWidth !== width || image.viewHeight !== height);
  if (main.length > 1) throw new MultiRegionScnError(main.length);
  const [image] = main;
  if (image === undefined || image.dimensions.length === 0) return null;
  return [...image.dimensions].sort((a, b) => a.r - b.r).map((dimension) => dimension.ifd);
}
