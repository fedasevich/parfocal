import { createContext, type ReactNode, useContext } from "react";
import { slideThumbUrl } from "../slide-thumb-url.ts";
import { overviewSize } from "./slide-geometry.ts";

const SlidePictureContext = createContext<string | undefined>(undefined);

export function SlidePicture({ slideId, children }: { slideId: string; children: ReactNode }) {
  return <SlidePictureContext.Provider value={slideId}>{children}</SlidePictureContext.Provider>;
}

export function useSlidePicture(): string {
  const slideId = useContext(SlidePictureContext);
  return slideId === undefined || slideId === "" ? "" : slideThumbUrl(slideId);
}

export function overviewImageOf(slideId: string) {
  return { src: slideThumbUrl(slideId), ...overviewSize };
}

export function useOverviewImage() {
  return { src: useSlidePicture(), ...overviewSize };
}
