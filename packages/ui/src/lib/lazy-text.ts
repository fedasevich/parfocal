function readsList(read: () => unknown): boolean {
  try {
    return Array.isArray(read());
  } catch {
    return false;
  }
}

export function lazyText<T extends object>(read: () => T): T {
  const target = (readsList(read) ? [] : {}) as T;
  const bound = (value: unknown, owner: object) =>
    typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(owner) : value;
  return new Proxy(target, {
    get(_, key) {
      const owner = read();
      return bound(Reflect.get(owner, key), owner);
    },
    has: (_, key) => Reflect.has(read(), key),
    ownKeys: () => Reflect.ownKeys(read()),
    getPrototypeOf: () => Reflect.getPrototypeOf(read()),
    getOwnPropertyDescriptor(own, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(read(), key);
      if (!descriptor) return undefined;
      if (key === "length") return Reflect.getOwnPropertyDescriptor(own, key);
      return { ...descriptor, configurable: true };
    },
  });
}
