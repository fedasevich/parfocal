import type { UploadEngine, UploadEngineOptions } from "./engine.ts";
import { readHints, type UploadEntry } from "./entries.ts";

function savedHints(): readonly UploadEntry[] {
  try {
    return readHints(window.sessionStorage);
  } catch {
    return [];
  }
}

export function createLazyUploadEngine(options: UploadEngineOptions): UploadEngine {
  const listeners = new Set<() => void>();
  let entries: readonly UploadEntry[] = savedHints();
  let loading: Promise<UploadEngine> | null = null;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const load = () => {
    loading ??= import("./engine.ts").then((module) => {
      const real = module.createUploadEngine(options);
      entries = real.getSnapshot();
      real.subscribe(() => {
        entries = real.getSnapshot();
        notify();
      });
      notify();
      return real;
    });
    return loading;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => entries,
    async addFiles(files, target, created) {
      await (await load()).addFiles(files, target, created);
    },
    pause(id) {
      void load().then((engine) => engine.pause(id));
    },
    resume(id) {
      void load().then((engine) => engine.resume(id));
    },
    retry(id) {
      void load().then((engine) => engine.retry(id));
    },
    async cancel(id) {
      await (await load()).cancel(id);
    },
    dismiss(id) {
      void load().then((engine) => engine.dismiss(id));
    },
  };
}
