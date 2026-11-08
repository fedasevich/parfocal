import { KeycapBindings } from "@parfocal/ui/components/keycap";
import { type ReactNode, useMemo } from "react";
import { useSignedInArea } from "../session/signed-in-area.ts";
import { useResolvedSettings } from "../shell/resolved-settings.ts";
import { keyRegistry } from "./catalogue.ts";
import { keyLabeller, resolveOf } from "./key-labels.ts";
import { PersonalKeys } from "./personal-keys.ts";
import { shortcutsOfSettings } from "./shortcut-settings.ts";

export function KeyBindingsProvider({ children }: { children: ReactNode }) {
  const enabled = useSignedInArea();
  const settings = useResolvedSettings(enabled);
  const shortcuts = useMemo(
    () => (settings === undefined ? undefined : shortcutsOfSettings(settings)),
    [settings],
  );
  const label = useMemo(() => keyLabeller(keyRegistry.defs, shortcuts), [shortcuts]);
  const resolve = useMemo(() => resolveOf(shortcuts), [shortcuts]);
  return (
    <PersonalKeys.Provider value={resolve}>
      <KeycapBindings label={label}>{children}</KeycapBindings>
    </PersonalKeys.Provider>
  );
}
