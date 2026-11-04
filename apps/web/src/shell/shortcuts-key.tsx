import { useCallback } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { destinations } from "./destinations.ts";
import { useGoTo } from "./router-link.tsx";

export function ShortcutsKey() {
  const goTo = useGoTo();
  const bindings = useBindings([], ["sheet"]);
  const onFire = useCallback(() => void goTo(destinations.settings("shortcuts")), [goTo]);
  useHotkeys(bindings, onFire);
  return null;
}
