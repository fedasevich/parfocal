import { useEffect, useState } from "react";
import { railToolOf } from "../viewer/stage-tools.ts";

type HintStorage = Pick<Storage, "getItem" | "setItem">;

const seenKey = "parfocal.tool-hints-seen";

const browserStorage = (): HintStorage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export function hintsSeen(storage: HintStorage | undefined = browserStorage()): Set<string> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(seenKey) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function markHintsSeen(
  tool: string,
  storage: HintStorage | undefined = browserStorage(),
): void {
  const seen = hintsSeen(storage);
  if (seen.has(tool)) return;
  seen.add(tool);
  try {
    storage?.setItem(seenKey, JSON.stringify([...seen]));
  } catch {}
}

export type ContextBarNeed = {
  readonly classStrip: boolean;
  readonly proposals: number;
  readonly hintsShown: boolean;
};

export function drawsContextBar(need: ContextBarNeed): boolean {
  return need.proposals > 0 || need.classStrip || need.hintsShown;
}

export function useHintsOnce(tool: string, hintOnly: boolean): boolean {
  const rail = railToolOf(tool);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!hintOnly) {
      setShown(null);
      return;
    }
    if (hintsSeen().has(rail)) {
      setShown((current) => (current === rail ? current : null));
      return;
    }
    markHintsSeen(rail);
    setShown(rail);
  }, [rail, hintOnly]);
  return hintOnly && shown === rail;
}
