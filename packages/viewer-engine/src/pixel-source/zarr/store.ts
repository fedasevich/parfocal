import type { AbsolutePath, AsyncReadable, RangeQuery } from "zarrita";

type StoreOptions = Parameters<AsyncReadable["get"]>[1];

export class AbsentChunkError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`The chunk ${key} is not in the store`);
    this.name = "AbsentChunkError";
    this.key = key;
  }
}

const metadataNames = [".zattrs", ".zgroup", ".zarray", ".zmetadata", "zarr.json"];

function isMetadata(key: string): boolean {
  return metadataNames.some((name) => key.endsWith(`/${name}`));
}

function checked(key: AbsolutePath, bytes: Uint8Array | undefined): Uint8Array | undefined {
  if (bytes === undefined && !isMetadata(key)) throw new AbsentChunkError(key);
  return bytes;
}

export function slideStore(inner: AsyncReadable): AsyncReadable {
  const store: AsyncReadable = {
    async get(key: AbsolutePath, options?: StoreOptions) {
      return checked(key, await inner.get(key, options));
    },
  };
  if (inner.getRange !== undefined) {
    store.getRange = async (key: AbsolutePath, range: RangeQuery, options?: StoreOptions) =>
      checked(key, await inner.getRange?.(key, range, options));
  }
  return store;
}
