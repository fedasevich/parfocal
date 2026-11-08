import { useSyncExternalStore } from "react";

export type FeedbackState =
  | { step: "closed" }
  | { step: "capturing" }
  | { step: "writing"; screenshot: string | null; path: string; viewport: [number, number] };

let state: FeedbackState = { step: "closed" };
const listeners = new Set<() => void>();

export const feedbackStore = {
  getState: (): FeedbackState => state,
  setState: (next: FeedbackState): void => {
    state = next;
    for (const listener of listeners) listener();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useFeedback(): FeedbackState {
  return useSyncExternalStore(
    feedbackStore.subscribe,
    () => state,
    () => state,
  );
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function redactedScreenshot(): Promise<string | null> {
  try {
    const { captureRedacted } = await import("./capture.ts");
    await nextFrame();
    await nextFrame();
    return await captureRedacted(document);
  } catch {
    return null;
  }
}

export function routePath(pathname: string): string {
  const safe = pathname.replace(/[^A-Za-z0-9/_.-]/g, "");
  return (safe.startsWith("/") ? safe : `/${safe}`).slice(0, 300);
}

export async function openFeedback(): Promise<void> {
  if (feedbackStore.getState().step !== "closed") return;
  feedbackStore.setState({ step: "capturing" });
  const screenshot = await redactedScreenshot();
  feedbackStore.setState({
    step: "writing",
    screenshot,
    path: routePath(window.location.pathname),
    viewport: [window.innerWidth, window.innerHeight],
  });
}

export function closeFeedback(): void {
  feedbackStore.setState({ step: "closed" });
}
