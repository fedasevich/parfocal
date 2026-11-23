import { saveStudySession, saveStudyTracePart } from "@parfocal/api-client";
import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { DeviceStorage } from "../shell/device-settings.ts";
import type { StudySession } from "./study-model.ts";
import { readStudy, subscribeStudy } from "./study-storage.ts";
import type { TraceBatch } from "./trace/trace-model.ts";
import { indexedDbSink, type TraceSink, uploadIntervalMs } from "./trace/trace-store.ts";

export type UploadState = "idle" | "sending" | "synced" | "waiting";

export type UploadTransport = {
  session: (
    key: string,
    body: { participant: string; round: number; answers_gz: string },
  ) => Promise<unknown>;
  part: (key: string, seq: number, body: { events_gz: string }) => Promise<unknown>;
};

export type UploadDeps = {
  transport: UploadTransport;
  readSession: (id: string) => StudySession | undefined;
  readBatch: (sessionId: string, index: number) => Promise<TraceBatch | undefined>;
  storage: DeviceStorage | undefined;
};

const outboxKey = "parfocal.study.outbox";

const outboxSchema = z.object({
  sessions: z.array(z.object({ id: z.string(), rev: z.number() })),
  parts: z.array(z.object({ sessionId: z.string(), index: z.number() })),
});

type Outbox = z.infer<typeof outboxSchema>;

const emptyOutbox = (): Outbox => ({ sessions: [], parts: [] });

export async function gzipBase64(value: unknown): Promise<string> {
  const stream = new Blob([JSON.stringify(value)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

export async function gunzipBase64(encoded: string): Promise<unknown> {
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as unknown;
}

export type Uploader = {
  markSession: (id: string) => void;
  queuePart: (sessionId: string, index: number) => void;
  flush: () => Promise<void>;
  state: () => UploadState;
  subscribe: (listener: () => void) => () => void;
  pending: () => number;
};

export function createUploader(deps: UploadDeps): Uploader {
  let state: UploadState = "idle";
  let running: Promise<void> | null = null;
  let again = false;
  let rev = 0;
  const listeners = new Set<() => void>();

  const setState = (next: UploadState) => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const read = (): Outbox => {
    try {
      const parsed = outboxSchema.safeParse(JSON.parse(deps.storage?.getItem(outboxKey) ?? "null"));
      return parsed.success ? parsed.data : emptyOutbox();
    } catch {
      return emptyOutbox();
    }
  };

  const write = (outbox: Outbox) => {
    try {
      deps.storage?.setItem(outboxKey, JSON.stringify(outbox));
    } catch {
      return;
    }
  };

  const change = (edit: (outbox: Outbox) => Outbox) => write(edit(read()));

  const sendSession = async (id: string) => {
    const session = deps.readSession(id);
    if (session === undefined) return;
    await deps.transport.session(id, {
      participant: session.participant,
      round: session.round,
      answers_gz: await gzipBase64(session),
    });
  };

  const sendPart = async (sessionId: string, index: number) => {
    const batch = await deps.readBatch(sessionId, index);
    if (batch === undefined) return;
    await deps.transport.part(sessionId, index, { events_gz: await gzipBase64(batch.events) });
  };

  const drain = async () => {
    const outbox = read();
    for (const entry of outbox.sessions) {
      await sendSession(entry.id);
      change((current) => ({
        ...current,
        sessions: current.sessions.filter(
          (known) => !(known.id === entry.id && known.rev === entry.rev),
        ),
      }));
    }
    for (const entry of outbox.parts) {
      await sendPart(entry.sessionId, entry.index);
      change((current) => ({
        ...current,
        parts: current.parts.filter(
          (known) => !(known.sessionId === entry.sessionId && known.index === entry.index),
        ),
      }));
    }
  };

  const pending = () => {
    const outbox = read();
    return outbox.sessions.length + outbox.parts.length;
  };

  const flush = (): Promise<void> => {
    if (running !== null) {
      again = true;
      return running;
    }
    if (pending() === 0) {
      if (state !== "idle") setState("synced");
      return Promise.resolve();
    }
    setState("sending");
    running = (async () => {
      try {
        do {
          again = false;
          await drain();
        } while (again || pending() > 0);
        setState("synced");
      } catch {
        setState("waiting");
      } finally {
        running = null;
      }
    })();
    return running;
  };

  return {
    markSession: (id) => {
      rev += 1;
      const stamp = rev;
      change((outbox) => ({
        ...outbox,
        sessions: [...outbox.sessions.filter((entry) => entry.id !== id), { id, rev: stamp }],
      }));
      if (state !== "sending") setState("waiting");
    },
    queuePart: (sessionId, index) => {
      change((outbox) =>
        outbox.parts.some((entry) => entry.sessionId === sessionId && entry.index === index)
          ? outbox
          : { ...outbox, parts: [...outbox.parts, { sessionId, index }] },
      );
      if (state !== "sending") setState("waiting");
    },
    flush,
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    pending,
  };
}

const browserStorage = (): DeviceStorage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const traceStore = indexedDbSink();

export const studyUploader: Uploader = createUploader({
  transport: {
    session: (key, body) => saveStudySession(key, body),
    part: (key, seq, body) => saveStudyTracePart(key, seq, body),
  },
  readSession: (id) => readStudy().sessions.find((session) => session.id === id),
  readBatch: async (sessionId, index) =>
    (await traceStore.read(sessionId)).find((batch) => batch.index === index),
  storage: browserStorage(),
});

export const uploadingSink = (inner: TraceSink, uploader: Uploader = studyUploader): TraceSink => ({
  put: async (batch) => {
    await inner.put(batch);
    uploader.queuePart(batch.sessionId, batch.index);
    void uploader.flush();
  },
  read: inner.read,
});

const uploadedSession = (session: StudySession) => session.tasks !== undefined;

export function watchStudySessions(
  uploader: Uploader,
  read: () => StudySession[],
  subscribe: (listener: () => void) => () => void,
): () => void {
  const seen = new Map<string, string>();
  const check = () => {
    let changed = false;
    for (const session of read()) {
      if (!uploadedSession(session)) continue;
      const text = JSON.stringify(session);
      if (seen.get(session.id) === text) continue;
      seen.set(session.id, text);
      uploader.markSession(session.id);
      changed = true;
    }
    if (changed) void uploader.flush();
  };
  check();
  return subscribe(check);
}

let starts = 0;
let stopWatching: (() => void) | null = null;

export function startStudyUpload(uploader: Uploader = studyUploader): () => void {
  starts += 1;
  if (starts === 1) {
    const unwatch = watchStudySessions(uploader, () => readStudy().sessions, subscribeStudy);
    const flush = () => void uploader.flush();
    const timer = window.setInterval(flush, uploadIntervalMs);
    window.addEventListener("online", flush);
    flush();
    stopWatching = () => {
      unwatch();
      window.clearInterval(timer);
      window.removeEventListener("online", flush);
    };
  }
  return () => {
    starts -= 1;
    if (starts === 0) {
      stopWatching?.();
      stopWatching = null;
    }
  };
}

export const useUploadState = (uploader: Uploader = studyUploader): UploadState =>
  useSyncExternalStore(uploader.subscribe, uploader.state);
