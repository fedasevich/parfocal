export type DraftMeta = { draft: string };

export const draftMeta = (operationId: string): DraftMeta => ({ draft: operationId });

export function isDraftMeta(meta: Record<string, unknown> | undefined): meta is DraftMeta {
  return typeof meta?.["draft"] === "string";
}

export function withQueryKey<Query extends object, Key>(
  query: Query,
  queryKey: Key,
): Query & { queryKey: Key } {
  const result = { queryKey } as Query & { queryKey: Key };
  for (const key of Object.keys(query)) {
    if (key === "queryKey") continue;
    Object.defineProperty(result, key, {
      enumerable: true,
      configurable: true,
      get: () => (query as Record<string, unknown>)[key],
    });
  }
  return result;
}
