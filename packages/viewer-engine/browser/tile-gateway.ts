import { open, readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import { crossOriginIsolated } from "./global-setup.ts";

type ObjectRange = { readonly offset?: number; readonly length?: number; readonly suffix?: number };

type StoredObject = {
  readonly key: string;
  readonly size: number;
  readonly httpEtag: string;
  readonly httpMetadata: { readonly contentType?: string };
  readonly body?: ReadableStream<Uint8Array>;
};

type Bucket = {
  head(key: string): Promise<StoredObject | null>;
  get(key: string, options?: { readonly range?: ObjectRange }): Promise<StoredObject | null>;
};

type HandleTiles = (
  request: Request,
  env: { readonly SLIDES: Bucket; readonly TILE_TOKEN_KEY: string },
  now: () => number,
  log: () => void,
) => Promise<Response>;

const tilesModule = "@parfocal/edge/tiles";
const { handleTiles } = (await import(tilesModule)) as { handleTiles: HandleTiles };

export interface GatewayOptions {
  readonly tenant: string;
  readonly slideDir: string;
  readonly appDir: string;
  readonly tokenKey: string;
  readonly allowOrigin?: string;
}

export interface Gateway {
  readonly origin: string;
  readonly preflights: string[];
  readonly reads: string[];
  close(): Promise<void>;
}

const appTypes: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
};

function folderBucket(tenant: string, folder: string): Bucket {
  const prefix = new RegExp(`^t/${tenant}/s/[^/]+/([^/]+)$`);
  const located = async (key: string) => {
    const name = prefix.exec(key)?.[1];
    if (name === undefined) return null;
    const path = join(folder, name);
    const info = await stat(path).catch(() => null);
    return info?.isFile() ? { path, size: info.size } : null;
  };
  const describe = (key: string, size: number): StoredObject => ({
    key,
    size,
    httpEtag: `"${size}"`,
    httpMetadata: {},
  });
  return {
    async head(key) {
      const found = await located(key);
      return found === null ? null : describe(key, found.size);
    },
    async get(key, options = {}) {
      const found = await located(key);
      if (found === null) return null;
      const { range = {} } = options;
      const start =
        range.suffix === undefined ? (range.offset ?? 0) : Math.max(0, found.size - range.suffix);
      const end = Math.min(
        found.size,
        range.length === undefined ? found.size : start + range.length,
      );
      const bytes = new Uint8Array(Math.max(0, end - start));
      const file = await open(found.path, "r");
      try {
        await file.read(bytes, 0, bytes.length, start);
      } finally {
        await file.close();
      }
      return { ...describe(key, found.size), body: new Blob([bytes]).stream() };
    },
  };
}

function corsHeaders(allowOrigin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD",
    "Access-Control-Allow-Headers": "authorization, range",
    "Access-Control-Expose-Headers": "content-range, etag",
    "Access-Control-Max-Age": "7200",
    "Cross-Origin-Resource-Policy": "cross-origin",
    Vary: "Origin",
  };
}

async function sendApp(appDir: string, pathname: string, response: ServerResponse) {
  const path = join(appDir, normalize(pathname.slice("/app/".length)));
  const bytes = await readFile(path).catch(() => null);
  if (bytes === null) {
    response.writeHead(404, crossOriginIsolated);
    response.end();
    return;
  }
  response.writeHead(200, {
    ...crossOriginIsolated,
    "content-type": appTypes[extname(path)] ?? "application/octet-stream",
    "content-length": bytes.length,
  });
  response.end(bytes);
}

function asRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  return new Request(`http://gateway${request.url ?? "/"}`, {
    method: request.method ?? "GET",
    headers,
  });
}

async function send(answer: Response, response: ServerResponse, extra: Record<string, string>) {
  const headers: Record<string, string> = {};
  answer.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const body = new Uint8Array(await answer.arrayBuffer());
  response.writeHead(answer.status, { ...headers, ...extra });
  response.end(body);
}

export async function startGateway(options: GatewayOptions): Promise<Gateway> {
  const preflights: string[] = [];
  const reads: string[] = [];
  const env = {
    SLIDES: folderBucket(options.tenant, options.slideDir),
    TILE_TOKEN_KEY: options.tokenKey,
  };
  const now = () => Math.floor(Date.now() / 1000);
  const cors = options.allowOrigin === undefined ? {} : corsHeaders(options.allowOrigin);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://gateway").pathname;
    void (async () => {
      if (pathname.startsWith("/app/")) {
        await sendApp(options.appDir, pathname, response);
        return;
      }
      if (request.method === "OPTIONS") {
        preflights.push(pathname);
        if (options.allowOrigin !== undefined) {
          response.writeHead(204, cors);
          response.end();
          return;
        }
      } else {
        reads.push(pathname);
      }
      await send(await handleTiles(asRequest(request), env, now, () => undefined), response, cors);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    preflights,
    reads,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
