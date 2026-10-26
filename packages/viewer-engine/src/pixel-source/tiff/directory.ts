import {
  BaseClient,
  BaseResponse,
  fromCustomClient,
  fromUrl,
  type GeoTIFF,
  GeoTIFFImage,
  getDecoder,
  type ImageFileDirectory,
  type RemoteSourceOptions,
} from "geotiff";
import { UnsupportedCodecError } from "../types.ts";
import { jpeg2000Compressions, registerJpeg2000Decoders } from "./jpeg2000/register.ts";

export const TIFF_BLOCK_SIZE = 1024 * 1024;

export type TagName = Parameters<ImageFileDirectory["loadValue"]>[0];

export interface TiffPage {
  readonly ifd: number;
  readonly subIfd: number | null;
  readonly image: GeoTIFFImage;
}

class InjectedResponse extends BaseResponse {
  readonly #response: Response;

  constructor(response: Response) {
    super();
    this.#response = response;
  }

  override get status(): number {
    return this.#response.status;
  }

  override getHeader(name: string): string | undefined {
    return this.#response.headers.get(name) ?? undefined;
  }

  override getData(): Promise<ArrayBuffer> {
    return this.#response.arrayBuffer();
  }
}

class InjectedFetchClient extends BaseClient {
  readonly #fetch: typeof globalThis.fetch;

  constructor(url: string, fetcher: typeof globalThis.fetch) {
    super(url);
    this.#fetch = fetcher;
  }

  override async request(options: RequestInit = {}): Promise<BaseResponse> {
    const init: RequestInit = {};
    if (options.headers !== undefined) init.headers = options.headers;
    if (options.signal) init.signal = options.signal;
    return new InjectedResponse(await this.#fetch(this.url, init));
  }
}

export async function openTiff(
  url: URL,
  signal?: AbortSignal,
  fetcher?: typeof globalThis.fetch,
): Promise<GeoTIFF> {
  registerJpeg2000Decoders();
  const options: RemoteSourceOptions & { blockSize: number } = { blockSize: TIFF_BLOCK_SIZE };
  const tiff =
    fetcher === undefined
      ? await fromUrl(url.href, options, signal)
      : await fromCustomClient(new InjectedFetchClient(url.href, fetcher), {}, signal);
  if (!tiff.littleEndian) tiff.parser.eager = true;
  return tiff;
}

async function subImages(tiff: GeoTIFF, image: GeoTIFFImage): Promise<GeoTIFFImage[]> {
  if (!image.fileDirectory.hasTag("SubIFDs")) return [];
  const offsets: ArrayLike<number | bigint> =
    (await image.fileDirectory.loadValue("SubIFDs")) ?? [];
  const images: GeoTIFFImage[] = [];
  for (const offset of Array.from(offsets, Number)) {
    const directory = await tiff.parser.parseFileDirectoryAt(offset);
    images.push(new GeoTIFFImage(directory, tiff.littleEndian, tiff.cache, tiff.source));
  }
  return images;
}

export async function listPages(tiff: GeoTIFF): Promise<TiffPage[]> {
  const count = await tiff.getImageCount();
  const pages: TiffPage[] = [];
  for (let ifd = 0; ifd < count; ifd++) {
    const image = await tiff.getImage(ifd);
    pages.push({ ifd, subIfd: null, image });
    const subs = await subImages(tiff, image);
    subs.forEach((sub, subIfd) => {
      pages.push({ ifd, subIfd, image: sub });
    });
  }
  return pages;
}

function area(page: TiffPage): number {
  return page.image.getWidth() * page.image.getHeight();
}

export function largestPyramid(pages: readonly TiffPage[]): TiffPage[] {
  const withSubIfds = new Set(pages.filter((page) => page.subIfd !== null).map((page) => page.ifd));
  const runs: TiffPage[][] = [];
  for (const page of pages) {
    if (!page.image.isTiled) continue;
    const current = runs.at(-1);
    const previous = current?.at(-1);
    const startsRun =
      current === undefined ||
      previous === undefined ||
      (page.subIfd === null && withSubIfds.has(page.ifd)) ||
      page.image.getWidth() > previous.image.getWidth() ||
      page.image.getHeight() > previous.image.getHeight();
    if (startsRun) runs.push([page]);
    else current.push(page);
  }
  let best: TiffPage[] = [];
  for (const run of runs) {
    const [first] = run;
    const [bestFirst] = best;
    if (first !== undefined && (bestFirst === undefined || area(first) > area(bestFirst)))
      best = run;
  }
  return best;
}

export async function loadTag(image: GeoTIFFImage, tag: TagName): Promise<unknown> {
  if (!image.fileDirectory.hasTag(tag)) return undefined;
  return image.fileDirectory.loadValue(tag);
}

export async function loadByteCounts(image: GeoTIFFImage): Promise<ArrayLike<number> | null> {
  const counts: unknown = await loadTag(image, "TileByteCounts");
  if (
    counts === undefined ||
    counts === null ||
    typeof counts !== "object" ||
    !("length" in counts)
  ) {
    return null;
  }
  return Array.from(counts as ArrayLike<number | bigint>, Number);
}

export async function assertDecodable(image: GeoTIFFImage): Promise<void> {
  const compression = Number(image.fileDirectory.getValue("Compression") ?? 1);
  if (jpeg2000Compressions.has(compression)) return;
  try {
    await getDecoder(compression, {
      tileWidth: image.getTileWidth(),
      tileHeight: image.getTileHeight(),
      predictor: 1,
      bitsPerSample: image.getBitsPerSample(0),
      planarConfiguration: image.planarConfiguration,
    });
  } catch {
    throw new UnsupportedCodecError(compression);
  }
}
