export type RouteTitles = Readonly<Record<string, string>>;

export function routeTitleOf(routeIds: readonly string[], titles: RouteTitles): string | undefined {
  for (const id of routeIds.toReversed()) {
    const title = titles[id];
    if (title !== undefined) return title;
  }
  return undefined;
}

export function pageTitleOf(parts: readonly (string | null | undefined)[]): string {
  return [...parts.filter((part): part is string => !!part), "Parfocal"].join(" · ");
}
