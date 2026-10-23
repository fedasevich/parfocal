import { TIFF_BLOCK_SIZE } from "../pixel-source/tiff/directory.ts";

export const defaultCachedBlocks = 100;

export interface RangeReply {
  readonly status: number;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentRange: string | null;
}

export interface RangeCacheStats {
  readonly fetches: number;
  readonly bytes: number;
  readonly blockHits: number;
  readonly blockJoins: number;
  readonly cachedBlocks: number;
}

export interface RangeCacheOptions {
  readonly blockSize?: number;
  readonly maxBlocks?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface RangeCache {
  get(url: string, range: string | null): Promise<RangeReply>;
  stats(): RangeCacheStats;
  clear(): void;
}

interface Block {
  readonly bytes: Uint8Array<ArrayBuffer>;
}

const byteRange = /^bytes=(\d+)-(\d+)$/;

const totalOf = (contentRange: string | null): number | null => {
  const match = /\/(\d+)$/.exec(contentRange ?? "");
  return match ? Number(match[1]) : null;
};

const startOf = (contentRange: string | null): number | null => {
  const match = /^bytes (\d+)-/.exec(contentRange ?? "");
  return match ? Number(match[1]) : null;
};

export function createRangeCache(options: RangeCacheOptions = {}): RangeCache {
  const blockSize = options.blockSize ?? TIFF_BLOCK_SIZE;
  const maxBlocks = options.maxBlocks ?? defaultCachedBlocks;
  const network = options.fetch ?? globalThis.fetch.bind(globalThis);
  const blocks = new Map<string, Block>();
  const pending = new Map<string, Promise<Block>>();
  const plain = new Map<string, Promise<RangeReply>>();
  const totals = new Map<string, number>();
  const counts = { fetches: 0, bytes: 0, blockHits: 0, blockJoins: 0 };

  const blockKey = (url: string, index: number) => `${index}@${url}`;

  const remember = (key: string, block: Block) => {
    blocks.delete(key);
    blocks.set(key, block);
    while (blocks.size > maxBlocks) {
      const oldest = blocks.keys().next();
      if (oldest.done) break;
      blocks.delete(oldest.value);
    }
  };

  const download = async (url: string, headers: HeadersInit) => {
    counts.fetches++;
    const response = await network(url, { headers });
    const bytes = new Uint8Array(await response.arrayBuffer());
    counts.bytes += bytes.byteLength;
    return { response, bytes };
  };

  const fetchRun = (url: string, first: number, last: number): Promise<Block>[] => {
    const run = (async () => {
      const { response, bytes } = await download(url, {
        Range: `bytes=${first * blockSize}-${(last + 1) * blockSize - 1}`,
      });
      const contentRange = response.headers.get("content-range");
      const total = totalOf(contentRange);
      if (total !== null) totals.set(url, total);
      if (response.status === 416) return new Uint8Array(0);
      if (response.status !== 206 || startOf(contentRange) !== first * blockSize) {
        throw new Error(`The server answered a range request with status ${response.status}`);
      }
      return bytes;
    })();
    const promises: Promise<Block>[] = [];
    for (let index = first; index <= last; index++) {
      const key = blockKey(url, index);
      const offset = (index - first) * blockSize;
      const block = run.then((bytes) => {
        const own = { bytes: bytes.slice(offset, offset + blockSize) };
        remember(key, own);
        return own;
      });
      pending.set(key, block);
      void block
        .finally(() => {
          if (pending.get(key) === block) pending.delete(key);
        })
        .catch(() => undefined);
      promises.push(block);
    }
    return promises;
  };

  const blockAt = (url: string, index: number): Promise<Block> | Block | undefined => {
    const key = blockKey(url, index);
    const cached = blocks.get(key);
    if (cached) {
      blocks.delete(key);
      blocks.set(key, cached);
      counts.blockHits++;
      return cached;
    }
    const inFlight = pending.get(key);
    if (inFlight) counts.blockJoins++;
    return inFlight;
  };

  const unsatisfiable = (total: number): RangeReply => ({
    status: 416,
    bytes: new Uint8Array(0),
    contentRange: `bytes */${total}`,
  });

  const ranged = async (url: string, start: number, end: number): Promise<RangeReply> => {
    const known = totals.get(url);
    if (known !== undefined && start >= known) return unsatisfiable(known);
    const first = Math.floor(start / blockSize);
    const last = Math.floor((known === undefined ? end : Math.min(end, known - 1)) / blockSize);
    const parts: (Promise<Block> | Block)[] = [];
    let missingFrom: number | null = null;
    const flush = (until: number) => {
      if (missingFrom === null) return;
      parts.push(...fetchRun(url, missingFrom, until));
      missingFrom = null;
    };
    for (let index = first; index <= last; index++) {
      const found = blockAt(url, index);
      if (found === undefined) {
        missingFrom ??= index;
        continue;
      }
      flush(index - 1);
      parts.push(found);
    }
    flush(last);
    const resolved = await Promise.all(parts.map((part) => Promise.resolve(part)));
    const total = totals.get(url) ?? null;
    if (total !== null && start >= total) return unsatisfiable(total);
    const stop = Math.min(end + 1, total ?? end + 1);
    const bytes = new Uint8Array(Math.max(0, stop - start));
    resolved.forEach((part, at) => {
      const blockStart = (first + at) * blockSize;
      const from = Math.max(start, blockStart);
      const to = Math.min(stop, blockStart + part.bytes.byteLength);
      if (to > from)
        bytes.set(part.bytes.subarray(from - blockStart, to - blockStart), from - start);
    });
    return {
      status: 206,
      bytes,
      contentRange: `bytes ${start}-${start + bytes.byteLength - 1}/${total ?? "*"}`,
    };
  };

  const passThrough = (url: string, range: string | null): Promise<RangeReply> => {
    const key = `${range ?? ""}@${url}`;
    const known = plain.get(key);
    if (known) return known;
    const reply = (async () => {
      const { response, bytes } = await download(url, range === null ? {} : { Range: range });
      return {
        status: response.status,
        bytes,
        contentRange: response.headers.get("content-range"),
      };
    })();
    plain.set(key, reply);
    void reply
      .finally(() => {
        plain.delete(key);
      })
      .catch(() => undefined);
    return reply;
  };

  return {
    async get(url, range) {
      const match = byteRange.exec(range ?? "");
      if (match === null) {
        const reply = await passThrough(url, range);
        return { ...reply, bytes: reply.bytes.slice() };
      }
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (end < start) {
        const reply = await passThrough(url, range);
        return { ...reply, bytes: reply.bytes.slice() };
      }
      return ranged(url, start, end);
    },
    stats() {
      return { ...counts, cachedBlocks: blocks.size };
    },
    clear() {
      blocks.clear();
    },
  };
}
