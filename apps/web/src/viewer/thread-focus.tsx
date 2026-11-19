import type { Thread } from "@parfocal/api-client";
import { useEffect, useRef } from "react";
import type { PinRegistry } from "../annotations/pin-registry.ts";
import type { SlideAreaEntry } from "./slide-areas.ts";
import { threadTarget } from "./thread-target.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export type ThreadFocusRequest = {
  readonly count: number;
  readonly anchor: Thread["anchor"];
  readonly openThreadId?: string | undefined;
};

export function ThreadFocus({
  engine,
  areas,
  request,
  pinRegistry,
}: {
  engine: ViewerEngine;
  areas: readonly SlideAreaEntry[];
  request: ThreadFocusRequest | null;
  pinRegistry?: PinRegistry | undefined;
}) {
  const latest = useRef(areas);
  latest.current = areas;
  useEffect(() => {
    if (request === null) return;
    const target = threadTarget(request.anchor, latest.current);
    if (target !== null) void engine.flyToArea(target);
    if (request.openThreadId !== undefined) pinRegistry?.open(request.openThreadId);
  }, [engine, request, pinRegistry]);
  return null;
}
