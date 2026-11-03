import { useGetMySettings } from "@parfocal/api-client";
import { KeycapBindings } from "@parfocal/ui/components/keycap";
import { type ReactNode, useMemo } from "react";
import { keyRegistry } from "./catalogue.ts";
import { keyLabeller } from "./key-labels.ts";

export function KeyBindingsProvider({ children }: { children: ReactNode }) {
  const shortcuts = useGetMySettings().data?.data.shortcuts;
  const label = useMemo(() => keyLabeller(keyRegistry.defs, shortcuts), [shortcuts]);
  return <KeycapBindings label={label}>{children}</KeycapBindings>;
}
