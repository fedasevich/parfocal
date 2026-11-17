import { useEffect, useRef, useState } from "react";
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

export function useHintsOnce(tool: string, hintOnly: boolean): boolean {
  const rail = railToolOf(tool);
  const { ready, seen, markSeen } = useHintsSeen();
  const [shown, setShown] = useState<string | null>(null);
  const seenRef = useRef(seen);
  const markRef = useRef(markSeen);
  seenRef.current = seen;
  markRef.current = markSeen;
  useEffect(() => {
    const id = toolHintId(rail);
    if (!hintOnly || !ready || seenRef.current.has(id)) {
      setShown(null);
      return;
    }
    setShown(rail);
    return () => markRef.current([id]);
  }, [rail, hintOnly, ready]);
  return hintOnly && shown === rail;
}
