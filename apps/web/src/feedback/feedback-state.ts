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

export async function openFeedback(): Promise<void> {
  if (feedbackStore.getState().step !== "closed") return;
  feedbackStore.setState({ step: "capturing" });
  const [{ captureRedacted }, { routePath }] = await Promise.all([
    import("./capture.ts"),
    import("./phi-areas.ts"),
  ]);
  await nextFrame();
  await nextFrame();
  const screenshot = await captureRedacted(document);
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
