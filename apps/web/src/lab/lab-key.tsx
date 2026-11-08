import { useGetMe } from "@parfocal/api-client";
import { useCallback, useEffect } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { okData } from "../screens/placeholder.tsx";
import { destinations } from "../shell/destinations.ts";
import { useGoTo } from "../shell/router-link.tsx";
import { canUseDeveloperMode, wantsLab } from "./developer-access.ts";

const developerPath = destinations.developer();

export function LabKey() {
  const goTo = useGoTo();
  const me = okData(useGetMe().data);
  const allowed = canUseDeveloperMode(me);
  const bindings = useBindings([], ["developer"], allowed);
  const onFire = useCallback(() => {
    if (window.location.pathname === developerPath) window.history.back();
    else void goTo(developerPath);
  }, [goTo]);
  useHotkeys(bindings, onFire);
  useEffect(() => {
    if (allowed && wantsLab(window.location.search) && window.location.pathname !== developerPath)
      void goTo(developerPath);
  }, [allowed, goTo]);
  return null;
}
