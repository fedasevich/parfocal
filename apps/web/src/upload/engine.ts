import AwsS3 from "@uppy/aws-s3";
import Uppy from "@uppy/core";
import {
  type FileIdentity,
  interruptedEntry,
  readHints,
  replaceEntry,
  sameFile,
  startedEntry,
  type UploadEntry,
  withDone,
  withError,
  withManualRetry,
  withPause,
  withProgress,
  withRetryStarted,
  writeHints,
} from "./entries.ts";
import { partSizeFor } from "./part-size.ts";

const PARALLEL_FILES = 3;

export type UploadMeta = {
  project_id: string;
  case_id?: string;
  size: number;
  last_modified: number;
};

export type CreatedListener = (uploadId: string) => void;

export type UploadTarget = { projectId: string; caseId: string | null };

export type UploadEngine = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly UploadEntry[];
  addFiles(files: readonly File[], target: UploadTarget, created?: CreatedListener): Promise<void>;
  pause(id: string): void;
  resume(id: string): void;
  retry(id: string): void;
  cancel(id: string): Promise<void>;
  dismiss(id: string): void;
};

export type UploadEngineOptions = {
  endpoint: string;
  storage?: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
};

type OpenUpload = { key: string; uploadId: string };

function metaOf(identity: FileIdentity): UploadMeta {
  return {
    project_id: identity.projectId,
    ...(identity.caseId === null ? {} : { case_id: identity.caseId }),
    size: identity.size,
    last_modified: identity.lastModified,
  };
}

export function createUploadEngine(options: UploadEngineOptions): UploadEngine {
  const { endpoint } = options;
  const storage = options.storage ?? window.sessionStorage;
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  const createdFor = new WeakMap<Blob, CreatedListener>();
  const announced = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let entries: readonly UploadEntry[] = readHints(storage);

  const uppy = new Uppy<UploadMeta, Record<string, never>>({ autoProceed: false });
  uppy.use(AwsS3, {
    companionEndpoint: endpoint,
    shouldUseMultipart: true,
    getChunkSize: (file) => partSizeFor(file.size),
    limit: PARALLEL_FILES,
  });

  function publish(next: readonly UploadEntry[]): void {
    entries = next;
    writeHints(storage, entries);
    for (const listener of listeners) listener();
  }

  function change(id: string, update: (entry: UploadEntry) => UploadEntry): void {
    publish(replaceEntry(entries, id, update));
  }

  function clearTimer(id: string): void {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
  }

  function startRetry(id: string): void {
    clearTimer(id);
    if (uppy.getFile(id) === undefined) return;
    change(id, withRetryStarted);
    void uppy.retryUpload(id).catch(() => undefined);
  }

  function scheduleRetry(id: string): void {
    const entry = entries.find((candidate) => candidate.id === id);
    if (entry?.status !== "retrying" || entry.retryAt === null) return;
    clearTimer(id);
    timers.set(
      id,
      setTimeout(() => startRetry(id), Math.max(0, entry.retryAt - now())),
    );
  }

  uppy.on("state-update", (_before, after) => {
    for (const file of Object.values(after.files)) {
      const uploadId = file.s3Multipart?.uploadId;
      if (uploadId === undefined) continue;
      if (entries.some((entry) => entry.id === file.id && entry.uploadId !== uploadId)) {
        change(file.id, (entry) => ({ ...entry, uploadId }));
      }
      if (announced.has(file.id)) continue;
      announced.add(file.id);
      if (file.data instanceof Blob) createdFor.get(file.data)?.(uploadId);
    }
  });
  uppy.on("upload-progress", (file, progress) => {
    if (file === undefined) return;
    change(file.id, (entry) => withProgress(entry, progress.bytesUploaded ?? 0));
  });
  uppy.on("upload-pause", (file, isPaused) => {
    if (file === undefined) return;
    change(file.id, (entry) => withPause(entry, isPaused));
  });
  uppy.on("upload-success", (file) => {
    if (file === undefined) return;
    clearTimer(file.id);
    change(file.id, (entry) => withDone(entry, entry.size));
  });
  uppy.on("upload-error", (file) => {
    if (file === undefined) return;
    change(file.id, (entry) => withError(entry, now()));
    scheduleRetry(file.id);
  });

  window.addEventListener("online", () => {
    for (const entry of entries) {
      if (entry.status === "retrying") startRetry(entry.id);
    }
  });

  async function findOpenUpload(identity: FileIdentity): Promise<OpenUpload | null> {
    const query = new URLSearchParams({
      project_id: identity.projectId,
      name: identity.name,
      size: String(identity.size),
      last_modified: String(identity.lastModified),
    });
    const response = await fetch(`${endpoint}/open?${query}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("The open upload could not be looked up");
    const body = (await response.json()) as { key?: unknown; uploadId?: unknown };
    if (typeof body.key !== "string" || typeof body.uploadId !== "string") return null;
    return { key: body.key, uploadId: body.uploadId };
  }

  async function addOne(file: File, target: UploadTarget): Promise<void> {
    const identity: FileIdentity = {
      ...target,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
    };
    const known = entries.find(
      (entry) => sameFile(entry, identity) && entry.status !== "interrupted",
    );
    if (known !== undefined) {
      if (known.status === "failed" || known.status === "retrying") startRetry(known.id);
      return;
    }
    const open = await findOpenUpload(identity);
    const id = uppy.addFile({
      name: file.name,
      type: file.type || "application/octet-stream",
      data: file,
      meta: metaOf(identity),
    });
    if (open !== null) uppy.setFileState(id, { s3Multipart: open });
    publish([
      ...entries.filter((entry) => !(entry.status === "interrupted" && sameFile(entry, identity))),
      startedEntry(id, identity),
    ]);
    void uppy.upload();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => entries,
    async addFiles(files, target, created) {
      for (const file of files) {
        if (created) createdFor.set(file, created);
        try {
          await addOne(file, target);
        } catch {
          const identity: FileIdentity = {
            ...target,
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
          };
          publish([
            ...entries.filter((entry) => !sameFile(entry, identity)),
            interruptedEntry(identity),
          ]);
        }
      }
    },
    pause(id) {
      const file = uppy.getFile(id);
      if (file !== undefined && entries.find((entry) => entry.id === id)?.status === "uploading") {
        uppy.pauseResume(id);
      }
    },
    resume(id) {
      const file = uppy.getFile(id);
      if (file !== undefined && entries.find((entry) => entry.id === id)?.status === "paused") {
        uppy.pauseResume(id);
      }
    },
    retry(id) {
      const entry = entries.find((candidate) => candidate.id === id);
      if (entry === undefined) return;
      if (uppy.getFile(id) === undefined) return;
      clearTimer(id);
      change(id, withManualRetry);
      void uppy.retryUpload(id).catch(() => undefined);
    },
    async cancel(id) {
      clearTimer(id);
      const file = uppy.getFile(id);
      const entry = entries.find((candidate) => candidate.id === id);
      if (file !== undefined) {
        const stored = file.s3Multipart;
        const listenersGone = entry?.status === "failed" || entry?.status === "retrying";
        if (listenersGone && stored !== undefined) {
          const query = new URLSearchParams({ key: stored.key });
          await fetch(`${endpoint}/s3/multipart/${encodeURIComponent(stored.uploadId)}?${query}`, {
            method: "DELETE",
          }).catch(() => undefined);
        }
        uppy.removeFile(id);
      }
      publish(entries.filter((candidate) => candidate.id !== id));
    },
    dismiss(id) {
      clearTimer(id);
      if (uppy.getFile(id) !== undefined) uppy.removeFile(id);
      publish(entries.filter((candidate) => candidate.id !== id));
    },
  };
}
