import {
  createServer,
  request as forward,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Writable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";

export const RTT_MATRIX_MS = [0, 50, 100, 200] as const;

export const CONTROL_PATH = "/__latency";

const SLICE_BYTES = 16 * 1024;
const IDLE_GAP_MS = 5;

export interface NetworkConditions {
  readonly rttMs: number;
  readonly bandwidthBytesPerSecond: number | null;
  readonly uplinkBytesPerSecond: number | null;
}

export interface ProxyStats {
  readonly requests: number;
  readonly bytes: number;
  readonly uploadedBytes: number;
}

export interface LatencyProxyOptions {
  readonly target: string;
  readonly port?: number;
  readonly host?: string;
  readonly rttMs?: number;
  readonly bandwidthBytesPerSecond?: number | null;
  readonly uplinkBytesPerSecond?: number | null;
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

function validateRate(name: string, rate: number | null): void {
  if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
    throw new RangeError(
      `${name} must be a positive number of bytes per second or null, got ${rate}`,
    );
  }
}

export function validateConditions(conditions: NetworkConditions): NetworkConditions {
  if (!Number.isFinite(conditions.rttMs) || conditions.rttMs < 0) {
    throw new RangeError(
      `RTT must be a finite number of milliseconds >= 0, got ${conditions.rttMs}`,
    );
  }
  validateRate("Bandwidth", conditions.bandwidthBytesPerSecond);
  validateRate("Uplink", conditions.uplinkBytesPerSecond);
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

function parseRate(value: string | null, current: number | null): number | null {
  if (value === null) {
    return current;
  }
  return value === "" || value === "unlimited" ? null : Number(value);
}

function parseConditions(url: URL, current: NetworkConditions): NetworkConditions {
  const rtt = url.searchParams.get("rtt");
  return validateConditions({
    rttMs: rtt === null ? current.rttMs : Number(rtt),
    bandwidthBytesPerSecond: parseRate(
      url.searchParams.get("bandwidth"),
      current.bandwidthBytesPerSecond,
    ),
    uplinkBytesPerSecond: parseRate(url.searchParams.get("uplink"), current.uplinkBytesPerSecond),
  });
}

function writeOrDrain(target: Writable, chunk: Buffer): Promise<void> {
  if (target.destroyed) {
    return Promise.reject(new Error("upstream closed"));
  }
  if (target.write(chunk)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const settle = (error?: Error) => {
      target.off("drain", onDrain);
      target.off("close", onClose);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onDrain = () => settle();
    const onClose = () => settle(new Error("upstream closed"));
    target.on("drain", onDrain);
    target.on("close", onClose);
  });
}

export async function startLatencyProxy(options: LatencyProxyOptions): Promise<LatencyProxy> {
  const target = new URL(options.target);
  let conditions = validateConditions({
    rttMs: options.rttMs ?? 0,
    bandwidthBytesPerSecond: options.bandwidthBytesPerSecond ?? null,
    uplinkBytesPerSecond: options.uplinkBytesPerSecond ?? null,
  });
  let requests = 0;
  let bytes = 0;
  let uploadedBytes = 0;
  const downlink = new Link();
  const uplink = new Link();

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
      uploadedBytes = 0;
    }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ ...conditions, requests, bytes, uploadedBytes }));
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
    uplink.open();
    try {
      for await (const chunk of incoming as AsyncIterable<Buffer>) {
        for (let start = 0; start < chunk.length; start += SLICE_BYTES) {
          const slice = chunk.subarray(start, start + SLICE_BYTES);
          await delay(uplink.reserve(slice.length, conditions.uplinkBytesPerSecond));
          await writeOrDrain(upstream, slice);
          uploadedBytes += slice.length;
        }
      }
      upstream.end();
    } catch (error) {
      upstream.destroy(error instanceof Error ? error : new Error(String(error)));
    } finally {
      uplink.close();
    }
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
    stats: () => ({ requests, bytes, uploadedBytes }),
    resetStats: () => {
      requests = 0;
      bytes = 0;
      uploadedBytes = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
