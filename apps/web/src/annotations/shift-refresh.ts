export type KeyTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export function bindShiftRefresh(target: KeyTarget, refresh: (shiftHeld: boolean) => void) {
  const onKey = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== "Shift") return;
    refresh(event.type === "keydown");
  };
  target.addEventListener("keydown", onKey, true);
  target.addEventListener("keyup", onKey, true);
  return () => {
    target.removeEventListener("keydown", onKey, true);
    target.removeEventListener("keyup", onKey, true);
  };
}
