import type { Thread } from "@parfocal/api-client";
import { useEffect, useRef } from "react";
import type { SlideAreaEntry } from "./slide-areas.ts";
import { threadTarget } from "./thread-target.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export type ThreadFocusRequest = {
  readonly count: number;
  readonly anchor: Thread["anchor"];
};

export function ThreadFocus({
  engine,
  areas,
  request,
}: {
  engine: ViewerEngine;
  areas: readonly SlideAreaEntry[];
  request: ThreadFocusRequest | null;
}) {
  const latest = useRef(areas);
  latest.current = areas;
  useEffect(() => {
    if (request === null) return;
    const target = threadTarget(request.anchor, latest.current);
    if (target !== null) void engine.flyToArea(target);
  }, [engine, request]);
  return null;
}
