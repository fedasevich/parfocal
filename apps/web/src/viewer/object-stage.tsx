import type { ReviewObject } from "@parfocal/api-client";
import { useEffect, useMemo } from "react";
import type { ViewerModule } from "./magnification-control.tsx";
import { SlideStage } from "./slide-stage.tsx";
import { outlineArea, placedObjects } from "./stage-geometry.ts";
import type { StageInspectorLink } from "./stage-inspector.tsx";
import type { ViewerEngine } from "./viewer-engine.ts";
import { layoutChromeOf } from "./viewer-layout.ts";

const chrome = layoutChromeOf("object");

const overlayId = "object-layout";

function ObjectFrame({
  engine,
  module,
  object,
  claimHidden,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  object: ReviewObject | undefined;
  claimHidden: boolean;
}) {
  const outline = object?.outline;
  const id = object?.object;
  useEffect(() => {
    const area = outlineArea(outline);
    void (area === null ? engine.flyToFit() : engine.flyToArea(area));
  }, [engine, outline]);
  const drawing = useMemo(
    () => module.createObjectDrawing({ id: overlayId, host: engine }),
    [module, engine],
  );
  useEffect(() => () => drawing.clear(), [drawing]);
  const placed = useMemo(
    () => (object === undefined || claimHidden ? [] : placedObjects([object])),
    [object, claimHidden],
  );
  useEffect(() => {
    drawing.setObjects(placed);
    drawing.setCurrent(id ?? null);
  }, [drawing, placed, id]);
  return (
    <div hidden data-testid="object-frame" data-object={id ?? ""} data-drawn={placed.length} />
  );
}

export function ObjectStage({
  slideId,
  object,
  objectId,
  claimHidden = false,
  className = "",
}: {
  slideId: string;
  object: ReviewObject | undefined;
  objectId: string;
  claimHidden?: boolean;
  className?: string;
}) {
  const inspector: StageInspectorLink = {
    tab: undefined,
    tabs: [],
    onTab: () => {},
    comments: null,
    opinion: null,
    extras: (session) => (
      <ObjectFrame
        engine={session.engine}
        module={session.module}
        object={object}
        claimHidden={claimHidden}
      />
    ),
  };
  return (
    <div
      data-testid="object-stage"
      data-layout="object"
      data-object={objectId}
      className={`relative flex min-h-0 min-w-0 flex-1 ${className}`}
    >
      <SlideStage
        key={slideId}
        slideId={slideId}
        workspace="look"
        readOnly
        inspector={inspector}
        bare={!chrome.rail}
        toolKeys={chrome.toolKeys}
      />
    </div>
  );
}
