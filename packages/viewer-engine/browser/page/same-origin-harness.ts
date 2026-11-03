import { type Fetcher, TileAccess } from "../../src/access/tile-access.ts";
import { openTiffSource, readTileIndex } from "../../src/pixel-source/index.ts";

export interface SignedOpen {
  readonly directory: string;
  readonly token: string;
  readonly withIndex: boolean;
}

export interface OpenTiming {
  readonly ms: number;
  readonly levels: number;
}

export interface SameOriginHarness {
  open(request: SignedOpen): Promise<OpenTiming>;
}

declare global {
  interface Window {
    sameOriginHarness: SameOriginHarness;
  }
}

const browserFetch: Fetcher = (input, init) => fetch(input, init);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function open({ directory, token, withIndex }: SignedOpen): Promise<OpenTiming> {
  const access = new TileAccess(() => Promise.resolve({ token, lifetimeSeconds: 600 }));
  await access.token();
  const read: typeof fetch = (input, init) => access.fetch(requestUrl(input), init, browserFetch);
  const started = performance.now();
  const index = withIndex
    ? readTileIndex(await (await read(new URL("tile-index.json", directory))).json())
    : undefined;
  const source = await openTiffSource({
    formatId: "generic-tiff",
    url: new URL("spread.tiff", directory).href,
    nativeJpeg: "off",
    fetch: read,
    ...(index === undefined ? {} : { index }),
  });
  const coarsest = source.levels.length - 1;
  const tile = await source.getTile({ level: coarsest, x: 0, y: 0 });
  const ms = performance.now() - started;
  const levels = source.levels.length;
  source.close();
  if (tile.absent) throw new Error("The coarsest tile was absent");
  return { ms, levels };
}

window.sameOriginHarness = { open };
