import { setResponseTransform } from "@parfocal/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { shellStore } from "./shell-store.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const seenNames = new Map<string, string>();

function learnNames(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) learnNames(entry);
    return;
  }
  if (!isRecord(value)) return;
  const { display_name: name, initials } = value;
  if (
    typeof name === "string" &&
    typeof initials === "string" &&
    name !== initials &&
    name !== ""
  ) {
    seenNames.set(name, initials);
  }
  for (const entry of Object.values(value)) learnNames(entry);
}

function maskText(text: string): string {
  let masked = text;
  const longestFirst = [...seenNames].sort((a, b) => b[0].length - a[0].length);
  for (const [name, initials] of longestFirst) masked = masked.split(name).join(initials);
  return masked;
}

function mask(value: unknown): unknown {
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map(mask);
  if (!isRecord(value)) return value;
  const masked: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) masked[key] = mask(entry);
  if (typeof masked.display_name === "string" && typeof masked.initials === "string") {
    masked.display_name = masked.initials;
  }
  if (typeof masked.email === "string") {
    const domain = masked.email.slice(masked.email.lastIndexOf("@"));
    const who = typeof masked.initials === "string" ? masked.initials.toLowerCase() : "member";
    if (domain.startsWith("@")) masked.email = `${who}${domain}`;
  }
  return masked;
}

export function maskNames(value: unknown): unknown {
  learnNames(value);
  return mask(value);
}

export function installNameMask(queryClient: QueryClient): () => void {
  let hidden = shellStore.getState().initialsOnly;
  setResponseTransform((data) => {
    if (hidden) return maskNames(data);
    learnNames(data);
    return data;
  });
  return shellStore.subscribe(() => {
    const next = shellStore.getState().initialsOnly;
    if (next === hidden) return;
    hidden = next;
    void queryClient.invalidateQueries();
  });
}
