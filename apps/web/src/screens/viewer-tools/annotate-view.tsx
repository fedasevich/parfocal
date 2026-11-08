import { useListAnnotationLayers, useListModelTiers } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Keycap } from "@parfocal/ui/components/keycap";
import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { MapOutline, MapViewport, SmartMinimap } from "@parfocal/ui/components/smart-minimap";
import { UndoToast } from "@parfocal/ui/components/undo-toast";
import {
  ContextBar,
  ContextDivider,
  ContextPill,
  LayerList,
  type LayerRow,
  TierPicker,
  TierPill,
} from "@parfocal/ui/components/viewer-tools";
import { Zone } from "@parfocal/ui/components/zone";
import { useEffect, useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { okData } from "../placeholder.tsx";
import { ReviewTop } from "../review/review-top.tsx";
import { regionShapes } from "../review/slide-geometry.ts";
import { type Camera, SlideStill } from "../review/slide-still.tsx";
import { ViewerFrame } from "../review/viewer-frame.tsx";
import type { SceneOf } from "../scenes.ts";
import { lookUrl } from "../thumbnails.ts";
import { placeMinimap } from "./minimap-placement.ts";
import {
  annotateCentre,
  annotateHome,
  annotatePromptBox,
  annotateSpots,
  mapBoxOf,
} from "./minimap-scenes.ts";
import { tiersFor } from "./model-tiers.ts";
import { annotateRail, toolHints } from "./rails.ts";
import { viewportOf } from "./slide-maps.tsx";
import { autoRegionProposals } from "./tool-geometry.ts";
import type { ToolSession } from "./tool-session.tsx";
import { HeldCorner } from "./use-held-corner.tsx";

const overviewImage = { src: lookUrl("overview"), width: 1400, height: 1924 };

const centre = annotateCentre;

const promptBox = annotatePromptBox;

const classColour = (name: string | null) =>
  name === "Tumor"
    ? "var(--c-tumor)"
    : name === "Immune"
      ? "var(--c-immune)"
      : name === "Stroma"
        ? "var(--c-stroma)"
        : "var(--fg-faint)";

type AnnotateViewProps = {
  tools: ToolSession;
  scene: SceneOf<"annotate">;
  initialTool?: "smart" | undefined;
  onScene: (scene: SceneOf<"annotate">) => void;
  onLeave: (tab: "objects" | "comments" | "opinion") => void;
};

export function AnnotateView({ tools, scene, initialTool, onScene, onLeave }: AnnotateViewProps) {
  const { session, counts } = tools;
  const goTo = useGoTo();
  const layers = okData(useListAnnotationLayers(session.slideId).data);
  const tierList = tiersFor(okData(useListModelTiers().data) ?? [], "outline");
  const [tool, setTool] = useState<string>(initialTool ?? "auto");
  const [tierName, setTierName] = useState("Best");
  const [proposals, setProposals] = useState(autoRegionProposals.length);
  const [added, setAdded] = useState(0);
  const [hidden, setHidden] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState("class");
  const [camera, setCamera] = useState<Camera | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void; id: number } | null>(null);
  const pickerOpen = scene === "models" && tool === "auto";
  const tier = tierList.find((item) => item.name === tierName) ?? tierList[0];
  const target = layers?.layers.find((layer) => layer.key === layers.new_shapes_go_to);

  const discard = () => {
    if (proposals === 0) return;
    const was = proposals;
    setProposals(0);
    setToast({ id: Date.now(), text: "Proposals discarded", undo: () => setProposals(was) });
  };
  const accept = () => {
    if (proposals === 0) return;
    const was = proposals;
    setAdded(added + was);
    setProposals(0);
    setToast({
      id: Date.now(),
      text: `${was} nuclei added to ${target?.name ?? "the layer"}`,
      undo: () => {
        setAdded(added);
        setProposals(was);
      },
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest("input, textarea, [role=dialog]")) return;
      const projectId = session.task?.project_id;
      if ((event.metaKey || event.ctrlKey) && event.key === "\\" && projectId) {
        event.preventDefault();
        void goTo(destinations.focus(projectId, session.slideId, session.task?.id));
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        if (pickerOpen) onScene("auto");
        else discard();
      }
      if (event.key === "Enter" && tool === "auto") accept();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const rows: LayerRow[] = (layers?.layers ?? []).map((layer) => ({
    key: layer.key,
    name: layer.name,
    colour: classColour(layer.class_name),
    count: layer.count + (layer.key === target?.key ? added : 0),
    child: layer.parent !== null,
    locked: layer.locked,
  }));
  const proposalRow: LayerRow = {
    key: "proposals",
    name: "Proposals, not saved",
    colour: "var(--c-prop)",
    proposal: true,
    count: proposals,
    current: true,
  };
  const firstOther = rows.findIndex((row) => !row.child && row.key !== target?.key);
  const orderedRows =
    firstOther < 0
      ? [...rows, proposalRow]
      : [...rows.slice(0, firstOther), proposalRow, ...rows.slice(firstOther)];

  const layersBody = (
    <>
      <Zone title="Layers" end={<Keycap keys="⌘G" />}>
        <LayerList
          rows={orderedRows}
          hidden={hidden}
          onToggle={(key) =>
            setHidden(
              hidden.includes(key) ? hidden.filter((item) => item !== key) : [...hidden, key],
            )
          }
        />
      </Zone>
      <Zone title="Group by">
        <SegmentedControl
          aria-label="Group by"
          fill
          value={groupBy}
          onValueChange={(value) => setGroupBy(String(value))}
          options={[
            { value: "class", label: "class" },
            { value: "cluster", label: "cluster" },
            { value: "region", label: "region" },
            { value: "source", label: "source" },
          ]}
        />
      </Zone>
      <Zone title="New shapes go to">
        <div className="flex items-center justify-between gap-2 text-body-sm">
          <span className="inline-flex items-center gap-2">
            <i aria-hidden="true" className="size-2.5 rounded-full bg-c-tumor" />
            tumor <Keycap keys="1" size="sm" />
          </span>
          <span className="text-fg-dim">into "{target?.name ?? ""}"</span>
        </div>
      </Zone>
    </>
  );

  const showProposals = proposals > 0 && !hidden.includes("proposals");

  return (
    <ViewerFrame
      session={session}
      counts={counts}
      topBar={<ReviewTop mode="annotate" session={session} counts={counts} />}
      tool={tool}
      railGroups={annotateRail}
      onToolChange={(next) => {
        setTool(next);
        if (scene === "models") onScene("auto");
      }}
      tab="display"
      onTabChange={(next) => {
        if (next !== "display") onLeave(next as "objects");
      }}
      scene={`annotate-${scene}`}
      tabs={[
        { value: "objects", label: "Objects", count: counts.total, body: null },
        { value: "display", label: "Display", count: orderedRows.length, body: layersBody },
        { value: "comments", label: "Comments", count: session.threads.length, body: null },
        { value: "opinion", label: "Opinion", body: null },
      ]}
    >
      <SlideStill
        view={{ kind: "whole" }}
        look="hpf"
        homeOf={annotateHome}
        camera={camera}
        onCameraChange={setCamera}
        regionDecisions={{}}
        bare
        minimap={false}
        hint={false}
        underlay={() =>
          showProposals ? (
            <g data-layer="proposals">
              {autoRegionProposals.map((cell) => (
                <g key={`${cell.x},${cell.y}`}>
                  <path
                    d={cell.path}
                    fill="rgb(255 255 255 / 0.14)"
                    stroke="#fff"
                    strokeWidth={5}
                  />
                  <path
                    d={cell.path}
                    fill="none"
                    stroke="var(--c-prop)"
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                  />
                </g>
              ))}
              <circle
                cx={centre.x}
                cy={centre.y}
                r={7}
                fill="#34d399"
                stroke="#fff"
                strokeWidth={2}
              />
              <circle
                cx={centre.x + 120}
                cy={centre.y + 60}
                r={7}
                fill="#f87171"
                stroke="#fff"
                strokeWidth={2}
              />
              <rect
                x={promptBox.x}
                y={promptBox.y}
                width={promptBox.size}
                height={promptBox.size}
                fill="none"
                stroke="#fff"
                strokeWidth={4.5}
              />
              <rect
                x={promptBox.x}
                y={promptBox.y}
                width={promptBox.size}
                height={promptBox.size}
                fill="none"
                stroke="var(--c-prop)"
                strokeWidth={2}
                strokeDasharray="12 8"
              />
            </g>
          ) : null
        }
        overlay={({ camera: shown, size }) => {
          const spots = annotateSpots(shown, size);
          const { extent } = spots;
          const fresh = placeMinimap(size, mapBoxOf(spots), spots.hot, spots.blocked);
          return (
            <>
              {tool === "auto" ? (
                <ContextBar label="Auto region">
                  {tier ? (
                    <TierPill
                      tier={tier}
                      open={pickerOpen}
                      onClick={() => onScene(pickerOpen ? "auto" : "models")}
                    />
                  ) : null}
                  <ContextPill>nuclei · 0.25 µm</ContextPill>
                  <ContextDivider />
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    <i
                      aria-hidden="true"
                      className="size-2 rounded-full bg-(--c-prop) shadow-[0_0_0_1.5px_#fff]"
                    />
                    {proposals} found
                  </span>
                  <Button size="sm" onClick={discard} disabled={proposals === 0}>
                    Discard <Keycap action="esc" keys="Esc" size="sm" />
                  </Button>
                  <Button size="sm" variant="primary" onClick={accept} disabled={proposals === 0}>
                    Accept as tumor <Keycap keys="↵" size="sm" />
                  </Button>
                </ContextBar>
              ) : (
                <ContextBar
                  label={annotateRail.flat().find((item) => item.tool === tool)?.label ?? tool}
                >
                  {(toolHints[tool] ?? []).map((hint) => (
                    <ContextPill key={hint}>{hint}</ContextPill>
                  ))}
                </ContextBar>
              )}
              {pickerOpen ? (
                <TierPicker
                  className="top-16.5 left-[calc(50%-250px)]"
                  title="Model for outlining nuclei"
                  tiers={tierList}
                  value={tierName}
                  onValueChange={(name) => {
                    setTierName(name);
                    onScene("auto");
                  }}
                  onClose={() => onScene("auto")}
                  note="The full model name shows when you point at a tier. Your lab decides which model each tier uses, and the report always records the exact model and version."
                />
              ) : null}
              <HeldCorner fresh={fresh} camera={shown}>
                {(place) => (
                  <SmartMinimap
                    data-corner={place.corner}
                    size="compact"
                    image={overviewImage}
                    extent={extent}
                    foot="Area 2"
                    footEnd={`${proposals} proposals`}
                    style={{ left: place.x, top: place.y }}
                  >
                    <MapOutline path={regionShapes.T2?.path ?? ""} />
                    <MapViewport rect={viewportOf("hpf", shown, size)} />
                  </SmartMinimap>
                )}
              </HeldCorner>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                <MagnificationBar
                  magnification={55}
                  scaleLabel="20 µm"
                  scalePx={92}
                  micronsPerPixel={0.18}
                />
              </div>
              {toast ? (
                <div className="absolute right-4 bottom-4">
                  <UndoToast
                    key={toast.id}
                    message={toast.text}
                    {...(toast.undo ? { onUndo: toast.undo } : {})}
                    onExpire={() => setToast(null)}
                  />
                </div>
              ) : null}
            </>
          );
        }}
      />
    </ViewerFrame>
  );
}
