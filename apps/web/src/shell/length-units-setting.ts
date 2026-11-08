import { useGetMySettings } from "@parfocal/api-client";
import { useEffect } from "react";
import { applySavedLengthUnits } from "../measure/length-units.ts";
import { useSignedInArea } from "../session/signed-in-area.ts";

export function useAppliedLengthUnits(): void {
  const enabled = useSignedInArea();
  const lengths = useGetMySettings({ query: { enabled } }).data?.data.personal.lengths;
  useEffect(() => applySavedLengthUnits(lengths), [lengths]);
}
