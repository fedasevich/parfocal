import { lazy, Suspense, useCallback, useRef } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { useOverlay } from "./overlays.ts";

const PaletteDialog = lazy(() => import("./command-palette-dialog.tsx"));

export function CommandPalette() {
  const overlay = useOverlay();
  const isOpen = overlay.open === "palette";
  const toggle = useRef(() => {});
  toggle.current = () => void overlay.set(isOpen ? undefined : "palette");
  const bindings = useBindings([], ["search"]);
  const onFire = useCallback(() => toggle.current(), []);
  useHotkeys(bindings, onFire);
  return isOpen ? (
    <Suspense fallback={null}>
      <PaletteDialog />
    </Suspense>
  ) : null;
}
