import { useCallback, useState, useSyncExternalStore } from "react";

const storageKey = "parfocal.guided-coach";
const changeEvent = "parfocal:guided-coach";
const guestKey = "guest";

function readStore(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function hasSeenGuidedCoach(userId: string | undefined): boolean {
  return readStore()[userId ?? guestKey] === true;
}

export function markGuidedCoachSeen(userId: string | undefined) {
  const store = readStore();
  store[userId ?? guestKey] = true;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(store));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(changeEvent));
}

function subscribe(onChange: () => void) {
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export type GuidedCoach = { open: boolean; dismiss: () => void; reopen: () => void };

export function useGuidedCoach(
  userId: string | undefined,
  firstVisitAllowed: boolean,
): GuidedCoach {
  const seen = useSyncExternalStore(
    subscribe,
    () => hasSeenGuidedCoach(userId),
    () => true,
  );
  const [reopened, setReopened] = useState(false);
  const dismiss = useCallback(() => {
    setReopened(false);
    markGuidedCoachSeen(userId);
  }, [userId]);
  const reopen = useCallback(() => setReopened(true), []);
  return { open: reopened || (firstVisitAllowed && !seen), dismiss, reopen };
}
