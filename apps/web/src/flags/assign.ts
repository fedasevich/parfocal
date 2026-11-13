const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

export function isPseudonymousId(value: string): boolean {
  return idPattern.test(value);
}

export function hashToUnit(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x100000000;
}

export function assignArm(flagKey: string, userId: string, arms: readonly string[]): string {
  const index = Math.floor(hashToUnit(`${flagKey}:${userId}`) * arms.length);
  return arms[Math.min(index, arms.length - 1)] as string;
}
