import {
  createServer,
  request as forward,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export const RTT_MATRIX_MS = [0, 50, 100, 200] as const;

export const CONTROL_PATH = "/__latency";

const SLICE_BYTES = 16 * 1024;
const IDLE_GAP_MS = 5;

export interface NetworkConditions {
  readonly rttMs: number;
  readonly bandwidthBytesPerSecond: number | null;
}

export interface ProxyStats {
  readonly requests: number;
  readonly bytes: number;
}

export interface LatencyProxyOptions {
  readonly target: string;
  readonly port?: number;
  readonly host?: string;
  readonly rttMs?: number;
  readonly bandwidthBytesPerSecond?: number | null;
}

export interface LatencyProxy {
  readonly url: string;
  readonly port: number;
  conditions(): NetworkConditions;
  setConditions(conditions: Partial<NetworkConditions>): void;
  stats(): ProxyStats;
  resetStats(): void;
  close(): Promise<void>;
}

export function validateConditions(conditions: NetworkConditions): NetworkConditions {
  if (!Number.isFinite(conditions.rttMs) || conditions.rttMs < 0) {
    throw new RangeError(
      `RTT must be a finite number of milliseconds >= 0, got ${conditions.rttMs}`,
    );
  }
  const bandwidth = conditions.bandwidthBytesPerSecond;
  if (bandwidth !== null && (!Number.isFinite(bandwidth) || bandwidth <= 0)) {
    throw new RangeError(
      `Bandwidth must be a positive number of bytes per second or null, got ${bandwidth}`,
    );
  }
  return conditions;
}

export function transferMs(bytes: number, bandwidthBytesPerSecond: number | null): number {
  return bandwidthBytesPerSecond === null ? 0 : (bytes * 1000) / bandwidthBytesPerSecond;
}

async function delay(ms: number): Promise<void> {
  if (ms > 0) {
    await sleep(ms);
  }
}

class Link {
  private freeAt = 0;
  private transfers = 0;

  open(): void {
    this.transfers++;
  }

  close(): void {
    this.transfers--;
    if (this.transfers === 0) {
      this.freeAt = 0;
    }
  }

  reserve(bytes: number, bandwidthBytesPerSecond: number | null): number {
    if (bandwidthBytesPerSecond === null) {
      return 0;
    }
    const now = performance.now();
    const start = now - this.freeAt > IDLE_GAP_MS ? now : this.freeAt;
    this.freeAt = start + transferMs(bytes, bandwidthBytesPerSecond);
    return this.freeAt - now;
  }
}

function parseConditions(url: URL, current: NetworkConditions): NetworkConditions {
  const rtt = url.searchParams.get("rtt");
  const bandwidth = url.searchParams.get("bandwidth");
  return validateConditions({
    rttMs: rtt === null ? current.rttMs : Number(rtt),
    bandwidthBytesPerSecond:
      bandwidth === null
        ? current.bandwidthBytesPerSecond
        : bandwidth === "" || bandwidth === "unlimited"
          ? null
          : Number(bandwidth),
  });
}

export async function startLatencyProxy(options: LatencyProxyOptions): Promise<LatencyProxy> {
  const target = new URL(options.target);
  let conditions = validateConditions({
    rttMs: options.rttMs ?? 0,
    bandwidthBytesPerSecond: options.bandwidthBytesPerSecond ?? null,
  });
  let requests = 0;
  let bytes = 0;
  const downlink = new Link();

  const control = (incoming: IncomingMessage, response: ServerResponse) => {
    const url = new URL(incoming.url ?? "/", "http://proxy");
    try {
      conditions = parseConditions(url, conditions);
    } catch (error) {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end(String(error));
      return;
    }
    if (url.searchParams.has("reset")) {
      requests = 0;
      bytes = 0;
    }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ ...conditions, requests, bytes }));
  };

  const relay = async (incoming: IncomingMessage, response: ServerResponse) => {
    requests++;
    await delay(conditions.rttMs);
    const upstream = forward({
      host: target.hostname,
      port: target.port,
      path: incoming.url,
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host },
    });
    upstream.on("error", (error) => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain" });
      }
      response.end(String(error));
    });
    upstream.on("response", (reply) => {
      downlink.open();
      void (async () => {
        try {
          response.writeHead(reply.statusCode ?? 502, reply.headers);
          for await (const chunk of reply as AsyncIterable<Buffer>) {
            for (let start = 0; start < chunk.length; start += SLICE_BYTES) {
              const slice = chunk.subarray(start, start + SLICE_BYTES);
              await delay(downlink.reserve(slice.length, conditions.bandwidthBytesPerSecond));
              bytes += slice.length;
              response.write(slice);
            }
          }
          response.end();
        } finally {
          downlink.close();
        }
      })().catch((error: unknown) => {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
      });
    });
    incoming.pipe(upstream);
  };

  const server = createServer((incoming, response) => {
    if (incoming.url?.startsWith(CONTROL_PATH)) {
      control(incoming, response);
      return;
    }
    relay(incoming, response).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
  server.keepAliveTimeout = 30_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  const host = options.host ?? "127.0.0.1";

  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    conditions: () => conditions,
    setConditions: (next) => {
      conditions = validateConditions({ ...conditions, ...next });
    },
    stats: () => ({ requests, bytes }),
    resetStats: () => {
      requests = 0;
      bytes = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
