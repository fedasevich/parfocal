import { useCallback, useEffect } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { destinations } from "../shell/destinations.ts";
import { useGoTo } from "../shell/router-link.tsx";
import { wantsLab } from "./developer-access.ts";
import {
  isSlidePath,
  openDeveloperDrawer,
  toggleDeveloperDrawer,
} from "./developer-drawer-state.ts";
import { useDeveloperAllowed } from "./use-developer-allowed.ts";

const developerPath = destinations.developer();

export function LabKey() {
  const goTo = useGoTo();
  const allowed = useDeveloperAllowed();
  const bindings = useBindings([], ["developer"], allowed);
  const onFire = useCallback(() => {
    const { pathname } = window.location;
    if (isSlidePath(pathname)) toggleDeveloperDrawer();
    else if (pathname === developerPath) window.history.back();
    else void goTo(developerPath);
  }, [goTo]);
  useHotkeys(bindings, onFire);
  useEffect(() => {
    if (!allowed || !wantsLab(window.location.search)) return;
    const { pathname } = window.location;
    if (isSlidePath(pathname)) openDeveloperDrawer();
    else if (pathname !== developerPath) void goTo(developerPath);
  }, [allowed, goTo]);
  return null;
}
