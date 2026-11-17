import { primeGrant } from "./tile-grant.ts";

export const loadViewerEngine = () => import("./viewer-engine.ts");

export function openSlideEarly(slideId: string, cause: "preload" | "enter" | "stay"): void {
  if (cause === "enter") primeGrant(slideId);
  loadViewerEngine().catch(() => {});
}
