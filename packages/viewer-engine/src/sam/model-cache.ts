export interface ModelCacheEntryStore {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
}

export interface ModelCacheStorage {
  open(name: string): Promise<ModelCacheEntryStore>;
}

export interface ModelStorageManager {
  persist(): Promise<boolean>;
}

export type ModelFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>;

export type ModelSource = "cache" | "network";

export type Revalidation = "unchanged" | "updated" | "failed";

export interface ModelLoad {
  readonly bytes: Uint8Array;
  readonly source: ModelSource;
  readonly downloadedBytes: number;
  readonly message: string;
  readonly replacedCorruptEntry: boolean;
  readonly revalidation: Promise<Revalidation> | null;
}

export interface ModelCacheOptions {
  readonly cacheName?: string;
  readonly caches: ModelCacheStorage;
  readonly fetch: ModelFetch;
  readonly storage?: ModelStorageManager | null;
  readonly onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
}

export interface ModelCache {
  load(url: string): Promise<ModelLoad>;
}

export class ModelDownloadError extends Error {
  readonly url: string;
  readonly reason: "http" | "not-onnx" | "truncated";

  constructor(url: string, reason: "http" | "not-onnx" | "truncated", detail: string) {
    super(`Model download failed for ${url}: ${detail}`);
    this.name = "ModelDownloadError";
    this.url = url;
    this.reason = reason;
  }
}

type CachedRead =
  | { readonly kind: "miss" }
  | { readonly kind: "corrupt" }
  | { readonly kind: "hit"; readonly bytes: Uint8Array; readonly etag: string | null };

const defaultCacheName = "parfocal-sam-models-v1";
const largestIrVersion = 32;
const varintWireType = 0;
const lengthDelimitedWireType = 2;

const modelProtoFields: Readonly<Record<number, number>> = {
  1: varintWireType,
  2: lengthDelimitedWireType,
  3: lengthDelimitedWireType,
  4: lengthDelimitedWireType,
  5: varintWireType,
  6: lengthDelimitedWireType,
  7: lengthDelimitedWireType,
  8: lengthDelimitedWireType,
  14: lengthDelimitedWireType,
  20: lengthDelimitedWireType,
};

export function hasOnnxProtobufHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 2) {
    return false;
  }
  const tag = bytes[0] ?? 0;
  const field = tag >> 3;
  const wireType = tag & 7;
  if (modelProtoFields[field] !== wireType) {
    return false;
  }
  if (field === 1) {
    const irVersion = bytes[1] ?? 0;
    return irVersion >= 1 && irVersion <= largestIrVersion;
  }
  return true;
}

export function describeModelLoad(source: ModelSource, downloadedBytes: number): string {
  if (source === "cache") {
    return "Loaded from cache";
  }
  const megabytes = Math.max(1, Math.round(downloadedBytes / 1_000_000));
  return `Downloaded ${megabytes} MB`;
}

function declaredLength(response: Response): number | null {
  const header = response.headers.get("content-length");
  if (header === null) {
    return null;
  }
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function readBody(
  response: Response,
  onProgress: ModelCacheOptions["onProgress"],
): Promise<Uint8Array> {
  const total = declaredLength(response);
  if (response.body === null) {
    const whole = new Uint8Array(await response.arrayBuffer());
    onProgress?.(whole.length, total);
    return whole;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    received += value.length;
    onProgress?.(received, total);
  }
  const whole = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    whole.set(chunk, offset);
    offset += chunk.length;
  }
  return whole;
}

function checkBytes(url: string, bytes: Uint8Array, expectedLength: number | null): void {
  if (expectedLength !== null && bytes.length !== expectedLength) {
    throw new ModelDownloadError(
      url,
      "truncated",
      `got ${bytes.length} of ${expectedLength} bytes`,
    );
  }
  if (!hasOnnxProtobufHeader(bytes)) {
    throw new ModelDownloadError(url, "not-onnx", "the body does not start like an ONNX model");
  }
}

function storedResponse(bytes: Uint8Array, source: Response): Response {
  const headers = new Headers();
  const etag = source.headers.get("etag");
  if (etag !== null) {
    headers.set("etag", etag);
  }
  headers.set("content-length", String(bytes.length));
  headers.set("content-type", "application/octet-stream");
  return new Response(bytes.slice(), { status: 200, headers });
}

export function createModelCache(options: ModelCacheOptions): ModelCache {
  const cacheName = options.cacheName ?? defaultCacheName;
  const storage = options.storage ?? null;
  let persistenceRequested = false;

  async function requestPersistence(): Promise<void> {
    if (persistenceRequested || storage === null) {
      return;
    }
    persistenceRequested = true;
    try {
      await storage.persist();
    } catch {
      return;
    }
  }

  async function download(url: string, store: ModelCacheEntryStore): Promise<Uint8Array> {
    const response = await options.fetch(url);
    if (!response.ok) {
      throw new ModelDownloadError(url, "http", `status ${response.status}`);
    }
    const bytes = await readBody(response, options.onProgress);
    checkBytes(url, bytes, declaredLength(response));
    await requestPersistence();
    try {
      await store.put(url, storedResponse(bytes, response));
    } catch {
      return bytes;
    }
    return bytes;
  }

  async function readCached(url: string, store: ModelCacheEntryStore): Promise<CachedRead> {
    const cached = await store.match(url);
    if (cached === undefined) {
      return { kind: "miss" };
    }
    try {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      checkBytes(url, bytes, declaredLength(cached));
      return { kind: "hit", bytes, etag: cached.headers.get("etag") };
    } catch {
      await store.delete(url);
      return { kind: "corrupt" };
    }
  }

  async function revalidate(
    url: string,
    store: ModelCacheEntryStore,
    etag: string | null,
  ): Promise<Revalidation> {
    if (etag === null) {
      return "unchanged";
    }
    try {
      const response = await options.fetch(url, { headers: { "If-None-Match": etag } });
      if (response.status === 304) {
        return "unchanged";
      }
      if (!response.ok) {
        return "failed";
      }
      if (response.headers.get("etag") === etag) {
        return "unchanged";
      }
      const bytes = await readBody(response, undefined);
      checkBytes(url, bytes, declaredLength(response));
      await store.put(url, storedResponse(bytes, response));
      return "updated";
    } catch {
      return "failed";
    }
  }

  return {
    async load(url) {
      const store = await options.caches.open(cacheName);
      const cached = await readCached(url, store);
      if (cached.kind === "hit") {
        return {
          bytes: cached.bytes,
          source: "cache",
          downloadedBytes: 0,
          message: describeModelLoad("cache", 0),
          replacedCorruptEntry: false,
          revalidation: revalidate(url, store, cached.etag),
        };
      }
      const bytes = await download(url, store);
      return {
        bytes,
        source: "network",
        downloadedBytes: bytes.length,
        message: describeModelLoad("network", bytes.length),
        replacedCorruptEntry: cached.kind === "corrupt",
        revalidation: null,
      };
    },
  };
}
