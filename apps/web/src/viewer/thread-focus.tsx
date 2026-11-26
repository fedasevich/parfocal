import type { Thread } from "@parfocal/api-client";
import { useEffect, useRef } from "react";
import { type AnchorPlace, anchorArea, anchorShapes } from "../annotations/anchor-place.ts";
import { onReach, type Reach } from "../annotations/comment-bus.ts";
import type { AnnotationDocument } from "../annotations/document.ts";
import { useSavedCodes } from "../annotations/drawn-object-ids.ts";
import type { PinRegistry } from "../annotations/pin-registry.ts";
import { useResultObjects } from "../annotations/result-objects.ts";
import type { Extent, ShapeId } from "../annotations/shapes.ts";
import type { SlideAreaEntry } from "./slide-areas.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export type ThreadFocusRequest = {
  readonly count: number;
  readonly anchor: Thread["anchor"];
  readonly openThreadId?: string | undefined;
};

type Pick = (ids: readonly ShapeId[], bounds: Extent | null) => void;

const anchorOfReach = (target: Reach): Thread["anchor"] | null => {
  switch (target.kind) {
    case "layer":
      return { kind: "layer", layer: target.key };
    case "object":
      return { kind: "object", object_id: target.id };
    case "anchor":
      return target.anchor;
    case "slide":
      return null;
  }
};

export function ThreadFocus({
  slideId,
  engine,
  areas,
  request,
  pinRegistry,
  document: doc,
  onPick,
}: {
  slideId: string;
  engine: ViewerEngine;
  areas: readonly SlideAreaEntry[];
  request: ThreadFocusRequest | null;
  pinRegistry?: PinRegistry | undefined;
  document: AnnotationDocument;
  onPick: Pick;
}) {
  const codes = useSavedCodes();
  const results = useResultObjects(slideId);
  const now = { place: { doc, codes, areas, results }, onPick, engine };
  const latest = useRef<{ place: AnchorPlace; onPick: Pick; engine: ViewerEngine }>(now);
  latest.current = now;
  const reach = useRef((anchor: Thread["anchor"]) => {
    const { place, onPick: pick, engine: shown } = latest.current;
    const shapes = anchorShapes(anchor, place);
    const area = anchorArea(anchor, place);
    const extent: Extent | null =
      area === null ? null : [area.x, area.y, area.x + area.width, area.y + area.height];
    if (shapes.length > 0) pick(shapes, extent);
    else if (area !== null) void shown.flyToArea(area);
  });
  useEffect(() => {
    if (request === null) return;
    reach.current(request.anchor);
    if (request.openThreadId !== undefined) pinRegistry?.open(request.openThreadId);
  }, [request, pinRegistry]);
  useEffect(
    () =>
      onReach(slideId, (target) => {
        const anchor = anchorOfReach(target);
        if (anchor !== null) reach.current(anchor);
      }),
    [slideId],
  );
  return null;
}
