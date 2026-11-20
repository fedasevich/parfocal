import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { ModeFallback } from "./slide-notice-list.tsx";
import { correctedMode, type ModeRule, type ViewerMode } from "./viewer-mode.ts";

const fallbackStore = create<{ slideId: string; fell: ModeFallback } | null>(() => null);

export function useModeCorrection(
  slideId: string,
  chosen: ViewerMode | undefined,
  rule: ModeRule,
  settled: boolean,
  onCorrect: ((mode: ViewerMode) => void) | undefined,
): ModeFallback | undefined {
  const fallback = fallbackStore();
  const correct = useRef(onCorrect);
  correct.current = onCorrect;
  const corrected = correctedMode(chosen, rule, settled);
  useEffect(() => {
    if (corrected === undefined || chosen === undefined || correct.current === undefined) return;
    fallbackStore.setState({ slideId, fell: { asked: chosen, shown: corrected } }, true);
    correct.current(corrected);
  }, [corrected, chosen, slideId]);
  return fallback?.slideId === slideId && fallback.fell.shown === rule.mode
    ? fallback.fell
    : undefined;
}
