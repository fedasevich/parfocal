import { useSyncExternalStore } from "react";
import { showUndoToast } from "./undo-toasts.tsx";

type Connection = { online: boolean; retrying: boolean };

const retryEveryMs = 5000;

let state: Connection = { online: true, retrying: false };
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const heldSaves = new Map<symbol, string>();

const publish = (next: Connection) => {
  state = next;
  for (const listener of listeners) listener();
};

const answers = async () => {
  try {
    await fetch(`/?connection-check=${Date.now()}`, {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(retryEveryMs),
    });
    return true;
  } catch {
    return false;
  }
};

const restore = () => {
  clearTimeout(timer);
  const labels = [...new Set(heldSaves.values())];
  heldSaves.clear();
  publish({ online: true, retrying: false });
  showUndoToast({
    message:
      labels.length === 0
        ? "Connection is back."
        : `Connection is back. ${labels.join(", ")} saved.`,
  });
};

const scheduleRetry = () => {
  clearTimeout(timer);
  timer = setTimeout(() => void retryNow(), retryEveryMs);
};

export async function retryNow(): Promise<void> {
  if (state.online || state.retrying) return;
  clearTimeout(timer);
  publish({ online: false, retrying: true });
  const answered = await answers();
  if (state.online) return;
  if (answered) {
    restore();
    return;
  }
  publish({ online: false, retrying: false });
  scheduleRetry();
}

export function markConnectionLost(): void {
  if (!state.online) return;
  publish({ online: false, retrying: false });
  scheduleRetry();
}

export function holdSaveUntilBack(label: string): () => void {
  const key = Symbol(label);
  heldSaves.set(key, label);
  return () => heldSaves.delete(key);
}

export function watchConnection(target: Window): () => void {
  const lost = () => markConnectionLost();
  const back = () => void retryNow();
  target.addEventListener("offline", lost);
  target.addEventListener("online", back);
  if (!target.navigator.onLine) markConnectionLost();
  return () => {
    target.removeEventListener("offline", lost);
    target.removeEventListener("online", back);
  };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useConnection = (): Connection => useSyncExternalStore(subscribe, () => state);
