import type { Deck, View } from "@deck.gl/core";

interface LoseContextExtension {
  loseContext(): void;
}

interface GlContextLike {
  isContextLost(): boolean;
  getExtension(name: "WEBGL_lose_context"): LoseContextExtension | null;
}

export interface DisposableDevice {
  readonly canvasContext?: { destroy(): void } | null;
  readonly gl?: GlContextLike | null;
}

interface DeckInternals {
  readonly device?: DisposableDevice | null;
  readonly animationLoop?: { readonly props?: { readonly device?: unknown } } | null;
}

export interface DisposableCanvas {
  width: number;
  height: number;
  remove(): void;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function releaseDevice(device: DisposableDevice | null | undefined): void {
  if (!device) return;
  device.canvasContext?.destroy();
  const gl = device.gl;
  if (gl && !gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
}

export function disposeDeck<Views extends View | View[] | null = null>(
  deck: Deck<Views>,
  canvas: HTMLCanvasElement | DisposableCanvas,
): void {
  const internals = deck as unknown as DeckInternals;
  const device = internals.device ?? null;
  const pendingDevice = device ? null : internals.animationLoop?.props?.device;
  deck.finalize();
  releaseDevice(device);
  if (isPromiseLike(pendingDevice)) {
    pendingDevice.then(
      (created) => releaseDevice(created as DisposableDevice | null),
      () => {},
    );
  }
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}
