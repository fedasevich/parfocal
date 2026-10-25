import type { Cancel } from "../engine/scheduling.ts";

const noObserver: Cancel = () => {};

export function observeCanvasSize(canvas: HTMLCanvasElement, onResize: () => void): Cancel {
  if (typeof ResizeObserver !== "function") return noObserver;
  const observer = new ResizeObserver(() => onResize());
  try {
    observer.observe(canvas, { box: "device-pixel-content-box" });
  } catch {
    observer.observe(canvas);
  }
  return () => observer.disconnect();
}

export function observePixelRatio(onChange: () => void): Cancel {
  if (typeof matchMedia !== "function") return noObserver;
  let stopCurrent: Cancel = noObserver;
  let stopped = false;

  const arm = () => {
    if (stopped) return;
    const query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    const listener = () => {
      onChange();
      arm();
    };
    query.addEventListener("change", listener, { once: true });
    stopCurrent = () => query.removeEventListener("change", listener);
  };

  arm();
  return () => {
    stopped = true;
    stopCurrent();
  };
}
