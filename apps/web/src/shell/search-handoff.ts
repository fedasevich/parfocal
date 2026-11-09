import { destinations } from "./destinations.ts";

export type SearchHandoff = { searchText: string };

export function searchHandoff(text: string) {
  return { href: destinations.search(), state: { searchText: text } satisfies SearchHandoff };
}

export function handoffText(state: unknown): string {
  if (typeof state !== "object" || state === null) return "";
  const text = (state as Partial<SearchHandoff>).searchText;
  return typeof text === "string" ? text : "";
}
