function pageUrl(): string | undefined {
  return typeof location === "undefined" ? undefined : location.href;
}

export function absoluteUrl(url: string | URL, baseUrl?: string | URL): URL {
  if (url instanceof URL) return url;
  const base = baseUrl ?? pageUrl();
  return base === undefined ? new URL(url) : new URL(url, base);
}
