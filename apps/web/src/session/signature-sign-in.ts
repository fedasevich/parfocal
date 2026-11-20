import { ApiError } from "@parfocal/api-client";

const pendingKey = "parfocal.signature-sign-in";
export const signatureResumeMs = 5 * 60_000;

export function currentPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function needsFreshSignIn(error: unknown): boolean {
  return error instanceof ApiError && error.problem?.code === "fresh-sign-in-needed";
}

type Pending = { path: string; at: number };

function readPending(): Pending | null {
  try {
    const value: unknown = JSON.parse(globalThis.sessionStorage?.getItem(pendingKey) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    if (!("path" in value) || !("at" in value)) return null;
    const { path, at } = value;
    return typeof path === "string" && typeof at === "number" ? { path, at } : null;
  } catch {
    return null;
  }
}

export function rememberSigning(path: string, at = Date.now()): void {
  globalThis.sessionStorage?.setItem(pendingKey, JSON.stringify({ path, at }));
}

export function signingPending(path: string, at = Date.now()): boolean {
  const pending = readPending();
  return pending !== null && pending.path === path && at - pending.at <= signatureResumeMs;
}

export function takePendingSigning(path: string, at = Date.now()): boolean {
  if (readPending()?.path !== path) return false;
  const pending = signingPending(path, at);
  globalThis.sessionStorage?.removeItem(pendingKey);
  return pending;
}
