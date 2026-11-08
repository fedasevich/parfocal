import { useMatches } from "@tanstack/react-router";
import { useEffect } from "react";
import { isSlideRoute, readingHold } from "./reading-hold.ts";

const inputEvents = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const;

export function useReadingReport() {
  const reading = useMatches({
    select: (matches) => matches.some((match) => isSlideRoute(match.routeId)),
  });
  useEffect(() => {
    if (!reading) return;
    readingHold.open(Date.now());
    const touch = () => readingHold.touch(Date.now());
    for (const name of inputEvents) {
      window.addEventListener(name, touch, { capture: true, passive: true });
    }
    return () => {
      for (const name of inputEvents) window.removeEventListener(name, touch, { capture: true });
      readingHold.close();
    };
  }, [reading]);
}
