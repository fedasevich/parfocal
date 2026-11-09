import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function setOpen(next: boolean): void {
  open = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const openFeedback = () => setOpen(true);
export const closeFeedback = () => setOpen(false);
export const useFeedbackOpen = () => useSyncExternalStore(subscribe, () => open);

export function feedbackRoute(matches: readonly { routeId: string }[]): string {
  const routeId = matches.at(-1)?.routeId ?? "__root__";
  return routeId.replace(/[^A-Za-z0-9/_.$-]/g, "").slice(0, 300) || "__root__";
}
