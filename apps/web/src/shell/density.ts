import { type DensityMode, densityMode } from "@parfocal/tokens";
import { useEffect } from "react";
import { useSignedInArea } from "../session/signed-in-area.ts";
import { useResolvedSettings } from "./resolved-settings.ts";

export function applyDensity(density: DensityMode, root: HTMLElement = document.documentElement) {
  root.dataset["density"] = density;
}

export function useAppliedDensity(): void {
  const enabled = useSignedInArea();
  const density = useResolvedSettings(enabled)?.density;
  useEffect(() => applyDensity(densityMode(density)), [density]);
}
