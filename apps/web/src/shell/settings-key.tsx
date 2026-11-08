import { useCallback } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { destinations } from "./destinations.ts";
import { useGoTo } from "./router-link.tsx";

export function SettingsKey() {
  const goTo = useGoTo();
  const bindings = useBindings([], ["settings"]);
  const onFire = useCallback(() => {
    if (window.location.pathname.startsWith("/settings/")) return;
    void goTo(destinations.settings("display"));
  }, [goTo]);
  useHotkeys(bindings, onFire);
  return null;
}
