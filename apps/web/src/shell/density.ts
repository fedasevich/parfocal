import { useGetMySettings } from "@parfocal/api-client";
import { type DensityMode, densityMode } from "@parfocal/tokens";
import { useEffect } from "react";

export function applyDensity(density: DensityMode, root: HTMLElement = document.documentElement) {
  root.dataset["density"] = density;
}

export function useAppliedDensity(): void {
  const density = useGetMySettings().data?.data.personal.density;
  useEffect(() => applyDensity(densityMode(density)), [density]);
}
