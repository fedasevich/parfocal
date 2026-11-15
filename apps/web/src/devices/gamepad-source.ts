import type { CameraInput } from "./camera-input.ts";
import type { RawInput } from "./intents.ts";

export type PadSnapshot = {
  readonly mapping: string;
  readonly connected?: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
};

export const padButtonNames: Record<number, string> = {
  0: "a",
  1: "b",
  2: "x",
  3: "y",
  4: "shoulder-left",
  5: "shoulder-right",
  8: "select",
  9: "start",
  12: "dpad-up",
  13: "dpad-down",
  14: "dpad-left",
  15: "dpad-right",
};

const leftTrigger = 6;
const rightTrigger = 7;
const selectIndex = 8;

export function isStandardPad(pad: PadSnapshot | null | undefined): pad is PadSnapshot {
  return pad != null && pad.connected !== false && pad.mapping === "standard";
}

const level = (pad: PadSnapshot, index: number) => pad.buttons[index]?.value ?? 0;

export function padAxes(pad: PadSnapshot): RawInput {
  return {
    kind: "axes",
    x: -(pad.axes[0] ?? 0),
    y: -(pad.axes[1] ?? 0),
    zoom: level(pad, rightTrigger) - level(pad, leftTrigger),
  };
}

export type GamepadReader = {
  readonly read: (pad: PadSnapshot) => RawInput[];
  readonly reset: () => RawInput[];
};

export function createGamepadReader(): GamepadReader {
  const down = new Set<number>();
  const read = (pad: PadSnapshot): RawInput[] => {
    const raws: RawInput[] = [padAxes(pad)];
    for (const [indexText, name] of Object.entries(padButtonNames)) {
      const index = Number(indexText);
      const pressed = pad.buttons[index]?.pressed ?? false;
      if (pressed === down.has(index)) continue;
      if (pressed) down.add(index);
      else down.delete(index);
      if (index === selectIndex) raws.push({ kind: "button", name, down: pressed });
      else if (pressed) raws.push({ kind: "button", name });
    }
    return raws;
  };
  const reset = (): RawInput[] => {
    const held = down.has(selectIndex);
    down.clear();
    return held ? [{ kind: "button", name: "select", down: false }] : [];
  };
  return { read, reset };
}

export type GamepadHost = {
  readonly getPads: () => readonly (PadSnapshot | null)[];
  readonly frames: { request: (cb: () => void) => number; cancel: (id: number) => void };
  readonly now: () => number;
  readonly focused: () => boolean;
};

export const deviceIntentEvent = "parfocal:device-intent";

export type PadEvents = {
  readonly addEventListener: (type: "gamepadconnected", listener: () => void) => void;
  readonly removeEventListener: (type: "gamepadconnected", listener: () => void) => void;
};

export function bindGamepadWhenConnected(
  input: CameraInput,
  host: GamepadHost,
  events: PadEvents,
): () => void {
  let stop: (() => void) | null = null;
  const start = () => {
    if (stop === null) stop = bindGamepad(input, host);
  };
  if (host.getPads().some(isStandardPad)) start();
  events.addEventListener("gamepadconnected", start);
  return () => {
    events.removeEventListener("gamepadconnected", start);
    stop?.();
    stop = null;
  };
}

export function bindGamepad(input: CameraInput, host: GamepadHost): () => void {
  const reader = createGamepadReader();
  let frame: number | null = null;
  let last = host.now();
  const tick = () => {
    frame = host.frames.request(tick);
    const now = host.now();
    const elapsed = now - last;
    last = now;
    const pad = host.getPads().find(isStandardPad);
    if (!host.focused() || !pad) {
      for (const raw of reader.reset()) input.push(raw, elapsed);
      return;
    }
    for (const raw of reader.read(pad)) input.push(raw, elapsed);
  };
  frame = host.frames.request(tick);
  return () => {
    if (frame !== null) host.frames.cancel(frame);
    frame = null;
    for (const raw of reader.reset()) input.push(raw, 0);
  };
}
