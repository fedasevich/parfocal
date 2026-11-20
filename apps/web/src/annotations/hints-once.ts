import { useCallback, useEffect, useRef, useState } from "react";
import { toolHintId, useHintsSeen } from "../hints/hints-seen.ts";
import { railToolOf } from "../viewer/stage-tools.ts";

export type ContextBarNeed = {
  readonly classStrip: boolean;
  readonly proposals: number;
  readonly hintsShown: boolean;
};

export function drawsContextBar(need: ContextBarNeed): boolean {
  return need.proposals > 0 || need.classStrip || need.hintsShown;
}

export type HintsOnce = {
  readonly shown: boolean;
  readonly dismiss: () => void;
};

export function hintLeftBehind(shownRail: string | null, rail: string): string | null {
  return shownRail !== null && shownRail !== rail ? toolHintId(shownRail) : null;
}

export function useHintsOnce(tool: string, wanted: boolean): HintsOnce {
  const rail = railToolOf(tool);
  const { ready, seen, markSeen } = useHintsSeen();
  const [shown, setShown] = useState<string | null>(null);
  const seenRef = useRef(seen);
  const markRef = useRef(markSeen);
  const shownRef = useRef<string | null>(null);
  seenRef.current = seen;
  markRef.current = markSeen;
  useEffect(() => {
    const left = hintLeftBehind(shownRef.current, rail);
    if (left !== null) markRef.current([left]);
    const id = toolHintId(rail);
    const showing = wanted && ready && !seenRef.current.has(id);
    shownRef.current = showing ? rail : null;
    setShown(showing ? rail : null);
  }, [rail, wanted, ready]);
  const dismiss = useCallback(() => {
    markRef.current([toolHintId(rail)]);
    shownRef.current = null;
    setShown(null);
  }, [rail]);
  return { shown: wanted && shown === rail, dismiss };
}
