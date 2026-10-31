import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface StaticRoute {
  readonly body: string | Uint8Array;
  readonly contentType: string;
}

export interface OriginServer {
  readonly url: string;
  close(): Promise<void>;
}

const BYTES_PATH = /^\/bytes\/(\d+)$/;
const SINK_PATH = "/sink";
const MAX_BYTES = 64 * 1024 * 1024;

export async function startOriginServer(
  routes: Readonly<Record<string, StaticRoute>> = {},
): Promise<OriginServer> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://origin").pathname;
    if (path === SINK_PATH) {
      let received = 0;
      request.on("data", (chunk: Buffer) => {
        received += chunk.length;
      });
      request.on("end", () => {
        response.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify({ received }));
      });
      return;
    }
    const route = routes[path];
    if (route) {
      response.writeHead(200, { "content-type": route.contentType, "cache-control": "no-store" });
      response.end(route.body);
      return;
    }
    const size = BYTES_PATH.exec(path)?.[1];
    if (size !== undefined && Number(size) <= MAX_BYTES) {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": size,
        "cache-control": "no-store",
      });
      response.end(Buffer.alloc(Number(size), 0x5a));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });
  server.keepAliveTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
