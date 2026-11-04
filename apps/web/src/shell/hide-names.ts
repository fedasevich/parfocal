import { setResponseTransform } from "@parfocal/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { shellStore } from "./shell-store.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function maskNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskNames);
  if (!isRecord(value)) return value;
  const masked: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) masked[key] = maskNames(entry);
  if (typeof masked.display_name === "string" && typeof masked.initials === "string") {
    masked.display_name = masked.initials;
  }
  return masked;
}

export function installNameMask(queryClient: QueryClient): () => void {
  let applied = shellStore.getState().initialsOnly;
  setResponseTransform(applied ? maskNames : undefined);
  return shellStore.subscribe(() => {
    const next = shellStore.getState().initialsOnly;
    if (next === applied) return;
    applied = next;
    setResponseTransform(next ? maskNames : undefined);
    void queryClient.invalidateQueries();
  });
}
