import { useCallback, useRef } from "react";
import { type AiEditBridge, idleAiBridge } from "./ai-edit.ts";
import type { Extent } from "./shapes.ts";

export function useAiBridge(drawn: unknown) {
  const bridge = useRef<AiEditBridge>({ ...idleAiBridge });
  const drawnStamp = useRef(0);
  const lastDrawn = useRef(drawn);
  if (lastDrawn.current !== drawn) {
    lastDrawn.current = drawn;
    drawnStamp.current = Date.now();
  }
  const onMarquee = useCallback(
    (area: Extent, additive: boolean) => bridge.current.marquee(area, additive),
    [],
  );
  const aiIsNewer = useCallback(() => bridge.current.stamp() > drawnStamp.current, []);
  return { bridge, onMarquee, aiIsNewer };
}
