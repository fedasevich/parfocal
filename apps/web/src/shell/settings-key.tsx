import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { destinations } from "./destinations.ts";
import { useGoTo } from "./router-link.tsx";

export function SettingsKey() {
  const goTo = useGoTo();
  const router = useRouter();
  const bindings = useBindings([], ["settings"]);
  const onFire = useCallback(() => {
    const location = router.state.location;
    if (location.pathname.startsWith("/settings/")) return;
    if ((location.search as { settings?: unknown }).settings !== undefined) return;
    void goTo(destinations.settings("display"));
  }, [goTo, router]);
  useHotkeys(bindings, onFire);
  return null;
}
