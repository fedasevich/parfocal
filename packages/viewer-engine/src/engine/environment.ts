import type { FrameScheduler, ResizeObserve } from "./types.ts";

export const animationFrames: FrameScheduler = {
  request: (callback) => globalThis.requestAnimationFrame(() => callback()),
  cancel: (handle) => globalThis.cancelAnimationFrame(handle),
};

export const observeElementResize: ResizeObserve = (container, onResize) => {
  const canObserve =
    typeof globalThis.ResizeObserver === "function" &&
    typeof globalThis.Element === "function" &&
    container instanceof Element;
  if (!canObserve) {
    return () => {};
  }
  const observer = new ResizeObserver(() => onResize());
  observer.observe(container);
  return () => observer.disconnect();
};
