import { z } from "zod";

const originSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("map"), box: z.string() }),
  z.object({
    kind: z.literal("walk"),
    chapter: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
  }),
]);

export type Origin = z.infer<typeof originSchema>;

export const originStorageKey = "parfocal.prototype.origin";

type OriginStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function parseOrigin(raw: string | null): Origin | null {
  if (raw === null) return null;
  try {
    const parsed = originSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createOriginStore(storage: OriginStorage | undefined) {
  const listeners = new Set<() => void>();
  let current = parseOrigin(storage?.getItem(originStorageKey) ?? null);
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    get: () => current,
    set: (origin: Origin | null) => {
      current = origin;
      if (origin === null) storage?.removeItem(originStorageKey);
      else storage?.setItem(originStorageKey, JSON.stringify(origin));
      notify();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type OriginStore = ReturnType<typeof createOriginStore>;
