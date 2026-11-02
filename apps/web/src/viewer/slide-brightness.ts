import { useCallback, useState } from "react";

const storageKey = "parfocal.slide-brightness";

function remembered(): number {
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored >= 20 && stored <= 140 ? stored : 100;
  } catch {
    return 100;
  }
}

export function useSlideBrightness(): [number, (value: number) => void] {
  const [value, setValue] = useState(remembered);
  const update = useCallback((next: number) => {
    setValue(next);
    try {
      window.localStorage.setItem(storageKey, String(next));
    } catch {
      return;
    }
  }, []);
  return [value, update];
}
