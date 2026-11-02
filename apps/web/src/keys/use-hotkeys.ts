import { useLayoutEffect, useRef } from "react";
import { type Binding, type Fired, idleKeys, isTyping, type KeyInput, step } from "./registry.ts";

export function useHotkeys(
  bindings: readonly Binding[],
  onFire: (fired: Fired) => void,
  onPending?: (keys: string[] | null) => void,
) {
  const state = useRef(idleKeys);
  useLayoutEffect(() => {
    const handle = (input: KeyInput, event?: KeyboardEvent) => {
      const result = step(bindings, state.current, input);
      const before = state.current.pending;
      state.current = result.state;
      if (result.consumed && event) event.preventDefault();
      if (before !== result.state.pending) onPending?.(result.state.pending?.keys ?? null);
      for (const fired of result.fired) onFire(fired);
    };
    const fromEvent = (type: "down" | "up") => (event: KeyboardEvent) =>
      handle(
        {
          type,
          key: event.key,
          code: event.code,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
          typing: isTyping(event.target),
          at: event.timeStamp,
        },
        event,
      );
    const down = fromEvent("down");
    const up = fromEvent("up");
    const blur = () => handle({ type: "blur", at: performance.now() });
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [bindings, onFire, onPending]);
}
