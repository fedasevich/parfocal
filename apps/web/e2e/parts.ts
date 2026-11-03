export const parts = [1, 2, 3, 4] as const;

export function inPart<T>(items: readonly T[], part: number): T[] {
  return items.filter((_, index) => index % parts.length === part - 1);
}
