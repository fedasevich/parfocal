import type { SaveState } from "./use-saved-annotations.ts";

export function saveStatusText(state: SaveState, unsaved: number): string | null {
  if (state === "idle") return null;
  if (state === "saving") return "Saving";
  if (state === "saved") return "All edits saved";
  if (state === "failed") return "Some edits were not saved";
  return unsaved === 1
    ? "Not connected, 1 edit waiting to save"
    : `Not connected, ${unsaved} edits waiting to save`;
}

export function SaveStatus({ state, unsaved }: { state: SaveState; unsaved: number }) {
  const text = saveStatusText(state, unsaved);
  if (text === null) return null;
  const tone = state === "failed" ? "text-bad" : state === "retrying" ? "text-warn" : "text-fg-dim";
  return (
    <p
      role={state === "failed" ? "alert" : "status"}
      data-testid="save-status"
      data-state={state}
      className={`absolute top-4 left-4 text-body-sm ${tone}`}
    >
      {text}
    </p>
  );
}
