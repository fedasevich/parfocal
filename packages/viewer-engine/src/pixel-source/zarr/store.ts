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

export type MetadataRewrite = (metadata: Uint8Array) => Uint8Array | null;

export function slideStore(inner: AsyncReadable, rewrite?: MetadataRewrite): AsyncReadable {
  const checked = (key: AbsolutePath, bytes: Uint8Array | undefined): Uint8Array | undefined => {
    if (bytes === undefined && !isMetadata(key)) throw new AbsentChunkError(key);
    return bytes;
  };
  const store: AsyncReadable = {
    async get(key: AbsolutePath, options?: StoreOptions) {
      const bytes = checked(key, await inner.get(key, options));
      if (bytes === undefined || rewrite === undefined || !isMetadata(key)) return bytes;
      return rewrite(bytes) ?? bytes;
    },
  };
  if (inner.getRange !== undefined) {
    store.getRange = async (key: AbsolutePath, range: RangeQuery, options?: StoreOptions) =>
      checked(key, await inner.getRange?.(key, range, options));
  }
  return store;
}
