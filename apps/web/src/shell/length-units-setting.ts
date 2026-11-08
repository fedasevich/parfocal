import { useEffect } from "react";
import { applySavedLengthUnits } from "../measure/length-units.ts";
import { useSignedInArea } from "../session/signed-in-area.ts";
import { useResolvedSettings } from "./resolved-settings.ts";

export function useAppliedLengthUnits(): void {
  const enabled = useSignedInArea();
  const lengths = useResolvedSettings(enabled)?.length_unit;
  useEffect(() => applySavedLengthUnits(lengths), [lengths]);
}
