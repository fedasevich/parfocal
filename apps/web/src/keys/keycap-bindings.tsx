import { useGetMySettings } from "@parfocal/api-client";
import { KeycapBindings } from "@parfocal/ui/components/keycap";
import { type ReactNode, useMemo } from "react";
import { keyRegistry } from "./catalogue.ts";
import { keyLabeller, resolveOf } from "./key-labels.ts";
import { PersonalKeys } from "./personal-keys.ts";

export function KeyBindingsProvider({ children }: { children: ReactNode }) {
  const shortcuts = useGetMySettings().data?.data.shortcuts;
  const label = useMemo(() => keyLabeller(keyRegistry.defs, shortcuts), [shortcuts]);
  const resolve = useMemo(() => resolveOf(shortcuts), [shortcuts]);
  return (
    <PersonalKeys.Provider value={resolve}>
      <KeycapBindings label={label}>{children}</KeycapBindings>
    </PersonalKeys.Provider>
  );
}
