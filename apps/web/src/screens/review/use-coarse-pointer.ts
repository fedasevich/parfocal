import { useSyncExternalStore } from "react";

const query = "(pointer: coarse)";

const subscribe = (notify: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

const read = () => typeof window.matchMedia === "function" && window.matchMedia(query).matches;

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
