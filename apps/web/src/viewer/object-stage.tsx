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

export type StageOutline = {
  readonly id: string;
  readonly ring: readonly number[];
  readonly colour: readonly [number, number, number, number];
};

const noOutlines: readonly StageOutline[] = [];

function ObjectFrame({
  engine,
  module,
  object,
  claimHidden,
  outlines,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  object: ReviewObject | undefined;
  claimHidden: boolean;
  outlines: readonly StageOutline[];
}) {
  const outline = object?.outline;
  const id = object?.object;
  const framed = useMemo(
    () => [...(outline ?? []), ...outlines.flatMap((entry) => entry.ring)],
    [outline, outlines],
  );
  useEffect(() => {
    const area = outlineArea(framed);
    void (area === null ? engine.flyToFit() : engine.flyToArea(area));
  }, [engine, framed]);
  const drawing = useMemo(
    () => module.createObjectDrawing({ id: overlayId, host: engine }),
    [module, engine],
  );
  useEffect(() => () => drawing.clear(), [drawing]);
  const placed = useMemo(() => {
    const claim = object === undefined || claimHidden ? [] : placedObjects([object]);
    const kind = object?.kind === "cell" ? ("cell" as const) : ("region" as const);
    const drawn = outlines.map((entry) => ({
      id: entry.id,
      kind,
      ring: entry.ring,
      className: "other" as const,
      classColour: entry.colour,
      score: 1,
    }));
    return [...claim, ...drawn];
  }, [object, claimHidden, outlines]);
  useEffect(() => {
    drawing.setObjects(placed);
    drawing.setCurrent(id ?? null);
  }, [drawing, placed, id]);
  return (
    <div
      hidden
      data-testid="object-frame"
      data-object={id ?? ""}
      data-drawn={placed.length}
      data-outlines={outlines.length}
    />
  );
}

export function ObjectStage({
  slideId,
  object,
  objectId,
  claimHidden = false,
  outlines = noOutlines,
  className = "",
}: {
  slideId: string;
  object: ReviewObject | undefined;
  objectId: string;
  claimHidden?: boolean;
  outlines?: readonly StageOutline[];
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
        outlines={outlines}
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
