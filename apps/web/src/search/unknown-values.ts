export function unknownValuesOf(
  rawSearch: string,
  allowed: Readonly<Record<string, readonly string[]>>,
): string[] {
  const params = new URLSearchParams(rawSearch);
  return Object.entries(allowed)
    .filter(([key, values]) => {
      const given = params.get(key);
      return given !== null && !values.includes(given);
    })
    .map(([key]) => key);
}
