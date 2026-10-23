import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";

export interface ServedRequest {
  readonly path: string;
  readonly range: string | null;
  bytes: number;
}

export interface Served {
  readonly origin: string;
  readonly requests: string[];
  readonly log: ServedRequest[];
  url(path: string): string;
  close(): Promise<void>;
}

export interface ServeOptions {
  readonly spaFallback?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
}

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
};

function contentType(path: string): Record<string, string> {
  const type = contentTypes[extname(path)];
  return type ? { "content-type": type } : {};
}

const fallbackPage = "<!doctype html><html><body>app</body></html>";

async function sizeOf(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

function sendRange(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  size: number,
  headers: Readonly<Record<string, string>>,
  entry: ServedRequest,
): void {
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
  if (range === null) {
    response.writeHead(200, {
      ...headers,
      ...contentType(path),
      "content-length": size,
      "accept-ranges": "bytes",
    });
    entry.bytes = size;
    createReadStream(path).pipe(response);
    return;
  }
  const start = Number(range[1]);
  const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
  if (start >= size) {
    response.writeHead(416, { ...headers, "content-range": `bytes */${size}` });
    response.end();
    return;
  }
  entry.bytes = end - start + 1;
  response.writeHead(206, {
    ...headers,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${size}`,
    "accept-ranges": "bytes",
  });
  createReadStream(path, { start, end }).pipe(response);
}

export async function serve(
  mounts: Record<string, string>,
  options: ServeOptions = {},
): Promise<Served> {
  const requests: string[] = [];
  const log: ServedRequest[] = [];
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    requests.push(pathname);
    const entry: ServedRequest = { path: pathname, range: request.headers.range ?? null, bytes: 0 };
    log.push(entry);
    const mount = Object.keys(mounts).find(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    const root = mount === undefined ? undefined : mounts[mount];
    const path =
      mount === undefined || root === undefined
        ? null
        : pathname === mount
          ? root
          : join(root, normalize(pathname.slice(mount.length + 1)));
    void (async () => {
      const size = path === null ? null : await sizeOf(path);
      if (path !== null && size !== null) {
        sendRange(request, response, path, size, options.headers ?? {}, entry);
      } else if (options.spaFallback) {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(fallbackPage);
      } else {
        response.writeHead(404);
        response.end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    requests,
    log,
    url: (path) => `${origin}${path}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
