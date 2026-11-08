import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Camera } from "../review/slide-still.tsx";
import { heldPlacement } from "./minimap-weights.ts";

export const cornerRestMs = 200;

export function useHeldCorner<T>(fresh: T, camera: Camera): T {
  const shown = useRef<T | null>(null);
  const [resting, setResting] = useState(true);
  const last = useRef(camera);
  useEffect(() => {
    if (last.current === camera) return;
    last.current = camera;
    setResting(false);
    const timer = window.setTimeout(() => setResting(true), cornerRestMs);
    return () => window.clearTimeout(timer);
  }, [camera]);
  const place = heldPlacement(shown.current, fresh, !resting);
  shown.current = place;
  return place;
}

export function HeldCorner<T>({
  fresh,
  camera,
  children,
}: {
  fresh: T;
  camera: Camera;
  children: (place: T) => ReactNode;
}) {
  return <>{children(useHeldCorner(fresh, camera))}</>;
}
