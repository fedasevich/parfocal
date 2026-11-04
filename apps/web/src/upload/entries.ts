export type UploadStatus = "uploading" | "paused" | "retrying" | "failed" | "done" | "interrupted";

export type FileIdentity = {
  projectId: string;
  caseId: string | null;
  name: string;
  size: number;
  lastModified: number;
};

export type UploadEntry = FileIdentity & {
  id: string;
  status: UploadStatus;
  bytesUploaded: number;
  attempt: number;
  retryAt: number | null;
};

const HINTS_KEY = "parfocal.uploads.interrupted";

export const retryDelaysMs = [2_000, 5_000, 15_000] as const;

export function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return (
    a.projectId === b.projectId &&
    a.name === b.name &&
    a.size === b.size &&
    a.lastModified === b.lastModified
  );
}

export function identityOf(entry: UploadEntry): FileIdentity {
  return {
    projectId: entry.projectId,
    caseId: entry.caseId,
    name: entry.name,
    size: entry.size,
    lastModified: entry.lastModified,
  };
}

export function interruptedEntry(identity: FileIdentity): UploadEntry {
  return {
    ...identity,
    id: `interrupted:${identity.projectId}:${identity.name}:${identity.size}:${identity.lastModified}`,
    status: "interrupted",
    bytesUploaded: 0,
    attempt: 0,
    retryAt: null,
  };
}

export function startedEntry(id: string, identity: FileIdentity): UploadEntry {
  return {
    ...identity,
    id,
    status: "uploading",
    bytesUploaded: 0,
    attempt: 0,
    retryAt: null,
  };
}

export function withProgress(entry: UploadEntry, bytesUploaded: number): UploadEntry {
  if (entry.status === "done") return entry;
  const advanced = bytesUploaded > entry.bytesUploaded;
  return {
    ...entry,
    status: entry.status === "paused" ? "paused" : "uploading",
    bytesUploaded,
    attempt: advanced ? 0 : entry.attempt,
    retryAt: null,
  };
}

export function withPause(entry: UploadEntry, paused: boolean): UploadEntry {
  if (entry.status === "done") return entry;
  return { ...entry, status: paused ? "paused" : "uploading", retryAt: null };
}

export function withError(entry: UploadEntry, now: number): UploadEntry {
  const delay = retryDelaysMs[entry.attempt];
  if (delay === undefined) {
    return { ...entry, status: "failed", retryAt: null };
  }
  return { ...entry, status: "retrying", attempt: entry.attempt + 1, retryAt: now + delay };
}

export function withRetryStarted(entry: UploadEntry): UploadEntry {
  return { ...entry, status: "uploading", retryAt: null };
}

export function withManualRetry(entry: UploadEntry): UploadEntry {
  return { ...entry, status: "uploading", attempt: 0, retryAt: null };
}

export function withDone(entry: UploadEntry, size: number): UploadEntry {
  return { ...entry, status: "done", bytesUploaded: size, retryAt: null };
}

export function replaceEntry(
  entries: readonly UploadEntry[],
  id: string,
  change: (entry: UploadEntry) => UploadEntry,
): UploadEntry[] {
  return entries.map((entry) => (entry.id === id ? change(entry) : entry));
}

export function isUnfinished(entry: UploadEntry): boolean {
  return entry.status !== "done";
}

export function encodeHints(entries: readonly UploadEntry[]): string {
  return JSON.stringify(entries.filter(isUnfinished).map(identityOf));
}

function isIdentity(value: unknown): value is FileIdentity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["projectId"] === "string" &&
    (candidate["caseId"] === null || typeof candidate["caseId"] === "string") &&
    typeof candidate["name"] === "string" &&
    typeof candidate["size"] === "number" &&
    typeof candidate["lastModified"] === "number"
  );
}

export function decodeHints(text: string | null): FileIdentity[] {
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter(isIdentity) : [];
  } catch {
    return [];
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function readHints(storage: Pick<Storage, "getItem">): UploadEntry[] {
  return decodeHints(storage.getItem(HINTS_KEY)).map(interruptedEntry);
}

export function writeHints(storage: Pick<Storage, "setItem">, entries: readonly UploadEntry[]) {
  storage.setItem(HINTS_KEY, encodeHints(entries));
}
