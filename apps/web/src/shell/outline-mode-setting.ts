import { useEffect } from "react";
import { useSignedInArea } from "../session/signed-in-area.ts";
import { outlineModeChoices, setOutlineMode } from "../viewer/outline-mode.ts";
import { useResolvedSettings } from "./resolved-settings.ts";

export function useAppliedOutlineMode(): void {
  const enabled = useSignedInArea();
  const mode = useResolvedSettings(enabled)?.outline_mode;
  useEffect(() => {
    const chosen = outlineModeChoices.find((choice) => choice === mode);
    if (chosen !== undefined) setOutlineMode(chosen);
  }, [mode]);
}
