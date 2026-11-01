import {
  LaneMap,
  LaneMapArrows,
  LaneMapBox,
  LaneMapHeader,
  LaneMapLane,
  LaneMapPill,
  LaneMapText,
} from "@parfocal/ui/components/lane-map";
import { Person } from "@parfocal/ui/components/person";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { mapLayout } from "../flow-map/geometry.ts";
import { originStore, usePeople, useScenarioIds } from "../flow-map/hooks.ts";
import {
  boxes,
  clinicalNote,
  isBuilt,
  lanes,
  mapDescription,
  mapTitle,
  waitLabel,
} from "../flow-map/review-flow.ts";
import { targetFor } from "../flow-map/targets.ts";
import { WalkBar } from "../flow-map/walk-bar.tsx";

export const Route = createFileRoute("/flow-map/")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: FlowMapPage,
});

const layout = mapLayout();

function FlowMapPage() {
  const ids = useScenarioIds();
  const people = usePeople();
  useEffect(() => originStore.set(null), []);
  return (
    <main className="flex min-h-screen flex-col gap-3 bg-page p-4">
      <div className="flex flex-wrap items-center gap-3">
        <WalkBar />
        <Link to="/prototype" className="ml-auto text-caption text-fg-faint underline">
          Prototype index
        </Link>
      </div>
      <LaneMap
        width={layout.width}
        height={layout.height}
        className="rounded-zone border border-line"
        data-testid="flow-map"
      >
        <LaneMapHeader title={mapTitle} description={mapDescription} />
        {lanes.map((lane) => {
          const rect = layout.lanes[lane.key];
          return (
            <LaneMapLane
              key={lane.key}
              top={rect.y}
              height={rect.h}
              title={lane.role}
              note={lane.note}
              people={lane.who.map((key) => (
                <Person key={key} person={people(key)} size={20} className="font-semibold" />
              ))}
            />
          );
        })}
        <LaneMapArrows arrows={layout.arrows} width={layout.width} height={layout.height} />
        {boxes.map((box) => {
          const rect = layout.boxes[box.id];
          if (rect === undefined) return null;
          const built = isBuilt(box);
          const target = ids
            ? targetFor(box.screen, ids, {
                scene: box.scene,
                clinical: box.clinical ?? false,
                submitted: box.submitted ?? false,
                as: box.who,
              })
            : null;
          return (
            <LaneMapBox
              key={box.id}
              x={rect.x}
              y={rect.y}
              w={rect.w}
              h={rect.h}
              title={box.title}
              sub={box.sub}
              dim={!built}
              data-box={box.id}
              aria-description={built ? undefined : "Not built yet, opens its placeholder"}
              render={
                target ? (
                  <Link
                    {...target}
                    onClick={() => {
                      if (ids) originStore.set({ kind: "map", box: box.id, ids });
                    }}
                  />
                ) : (
                  <span aria-disabled="true" />
                )
              }
            />
          );
        })}
        {layout.pills.map((pill) => (
          <LaneMapPill key={pill.label} x={pill.x} y={pill.y}>
            {pill.label}
          </LaneMapPill>
        ))}
        <LaneMapText x={layout.wait.x} y={layout.wait.y} w={layout.wait.w} align="center">
          {waitLabel}
        </LaneMapText>
        <LaneMapText x={layout.note.x} y={layout.note.y} w={layout.note.w}>
          {clinicalNote}
        </LaneMapText>
      </LaneMap>
    </main>
  );
}
