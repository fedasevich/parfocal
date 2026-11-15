import { useEffect } from "react";
import { createFrameMonitor, type FrameReporter, type Renderer } from "./frame-monitor.ts";

const inputs = ["pointerdown", "pointermove", "wheel", "keydown"] as const;

function isInteraction(event: Event): boolean {
  return event.type !== "pointermove" || (event as PointerEvent).buttons > 0;
}

export function useFrameMonitor(
  stage: HTMLElement | null,
  renderer: Renderer | undefined,
  reporter: FrameReporter,
) {
  useEffect(() => {
    if (stage === null || renderer === undefined) return;
    const monitor = createFrameMonitor(renderer, reporter);
    let frame = 0;
    let running = false;
    const tick = (now: number) => {
      running = monitor.frame(now);
      if (running) frame = requestAnimationFrame(tick);
    };
    const input = (event: Event) => {
      if (!isInteraction(event)) return;
      monitor.input(performance.now());
      if (running) return;
      running = true;
      frame = requestAnimationFrame(tick);
    };
    const hidden = () => monitor.flush();
    for (const name of inputs) stage.addEventListener(name, input, { passive: true });
    window.addEventListener("pagehide", hidden);
    return () => {
      cancelAnimationFrame(frame);
      for (const name of inputs) stage.removeEventListener(name, input);
      window.removeEventListener("pagehide", hidden);
      monitor.flush();
    };
  }, [stage, renderer, reporter]);
}
