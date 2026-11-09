import type { MagnificationLabel } from "@parfocal/ui/lib/magnification-bar";
import { useSignedInArea } from "../session/signed-in-area.ts";
import { useResolvedSettings } from "./resolved-settings.ts";

export function useMagnificationLabel(): MagnificationLabel {
  const enabled = useSignedInArea();
  return useResolvedSettings(enabled)?.magnification_label ?? "objective";
}
