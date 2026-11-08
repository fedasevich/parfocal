import { type ProjectSlide, useListProjectSlides } from "@parfocal/api-client";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Switch } from "@parfocal/ui/components/switch";
import {
  Crosshair,
  FloatingPill,
  PaneHeader,
  PanePicker,
  type PaneSide,
  type PaneSlide,
  SideToggles,
  SlidesOnScreenPanel,
} from "@parfocal/ui/components/viewer-tools";
import { Zone } from "@parfocal/ui/components/zone";
import {
  alignViews,
  alignWithOffset,
  createLinkedViews,
  registerThumbnails,
  relinkViews,
  toggleLinked,
  unlinkViews,
} from "@parfocal/viewer-engine";
import { type CSSProperties, useEffect, useState } from "react";
import { useBindings } from "../../keys/personal-keys.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { okData } from "../placeholder.tsx";
import { type Camera, midSize, SlideStill } from "../review/slide-still.tsx";
import { ViewerFrame } from "../review/viewer-frame.tsx";
import type { SceneOf } from "../scenes.ts";
import { lookUrl } from "../thumbnails.ts";
import {
  cameraOfView,
  moveCameraKeepingRotation,
  offsetFromRegistration,
  rotatePane,
  rotationOfView,
  rotationStep,
} from "./link-camera.ts";
import { reviewRail } from "./rails.ts";
import { grayPixelsOf } from "./thumbnail-pixels.ts";
import { midEdge } from "./tool-geometry.ts";
import { coverHome } from "./tool-maths.ts";
import type { ToolSession } from "./tool-session.tsx";

const stainFilter = "grayscale(1) sepia(.85) hue-rotate(-12deg) saturate(1.5) brightness(1.02)";

type CompareSlide = PaneSlide & { id: string; ihc: boolean; flip: boolean; note: string };

function toCompareSlide(slide: ProjectSlide, index: number, currentId: string): CompareSlide {
  const ihc = slide.stain !== "H&E";
  const flip = !ihc && index % 2 === 1;
  return {
    key: slide.id,
    id: slide.id,
    name: `${slide.label} · ${slide.stain}`,
    ihc,
    flip,
    simulated: ihc,
    thumb: {
      backgroundImage: `url(${lookUrl("overview")})`,
      ...(ihc ? { filter: stainFilter } : {}),
      ...(flip ? { transform: "scaleX(-1)" } : {}),
    },
    note:
      slide.id === currentId
        ? "The slide you were reading"
        : ihc
          ? "Cytokeratin, marks tumor cells brown"
          : "Second level of the same block",
  };
}

const sides: readonly PaneSide[] = ["left", "right"];
const linkReference: PaneSide = "left";

const other = (side: PaneSide): PaneSide => (side === "left" ? "right" : "left");

type CompareViewProps = {
  tools: ToolSession;
  scene: SceneOf<"compare">;
  rightSlideId?: string | undefined;
  onLeave: (change: {
    scene?: undefined;
    tab?: "objects" | "display" | "comments" | "opinion";
  }) => void;
};

export function CompareView({ tools, scene, rightSlideId, onLeave }: CompareViewProps) {
  const { session, projectId, counts } = tools;
  const all = okData(useListProjectSlides(projectId).data) ?? [];
  const caseSlides = all
    .filter((slide) => slide.case?.label === session.caseLabel)
    .map((slide, index) => toCompareSlide(slide, index, session.slideId));
  const [chosen, setChosen] = useState<Record<PaneSide, string | null>>({
    left: null,
    right: rightSlideId ?? null,
  });
  const [picking, setPicking] = useState<PaneSide | null>(scene === "picking" ? "right" : null);
  const [link, setLink] = useState(() => createLinkedViews(sides));
  const linked = link.linked;
  const [cursor, setCursor] = useState(true);
  const [layout, setLayout] = useState("side");
  const [layers, setLayers] = useState([
    { key: "outline", name: "Tumor map outline", left: true, right: false },
    { key: "measurements", name: "Measurements", left: true, right: false },
    { key: "comments", name: "Comments", left: true, right: true },
  ]);
  const fallbackRight = caseSlides.find((slide) => slide.ihc) ?? caseSlides[1];
  const ids: Record<PaneSide, string | undefined> = {
    left: chosen.left ?? session.slideId,
    right: chosen.right ?? fallbackRight?.id,
  };
  const slideOn = (side: PaneSide) => caseSlides.find((slide) => slide.id === ids[side]);
  const pick = (side: PaneSide, id: string) => {
    const there = other(side);
    if (ids[there] === id) setChosen({ [side]: id, [there]: ids[side] ?? null } as typeof chosen);
    else setChosen({ ...chosen, left: ids.left ?? null, right: ids.right ?? null, [side]: id });
    setPicking(null);
  };
  const swap = () => {
    setChosen({ left: ids.right ?? null, right: ids.left ?? null });
    setLayers(layers.map((row) => ({ ...row, left: row.right, right: row.left })));
    setPicking(null);
  };
  const rotationOf = (side: PaneSide) => rotationOfView(link.views[side]);
  const cameraOn = (side: PaneSide) => cameraOfView(link.views[side]);
  const moveCamera = (side: PaneSide, camera: Camera | null) =>
    setLink((state) => moveCameraKeepingRotation(state, side, camera));
  const rotateOn = (side: PaneSide, shown: Camera, change: { by: number } | { to: number }) =>
    setLink((state) => rotatePane(state, side, shown, change));
  const setLinked = (on: boolean) =>
    setLink((state) => (on ? relinkViews(state, linkReference) : unlinkViews(state)));

  const [alignment, setAlignment] = useState<"idle" | "working" | "done" | "none">("idle");
  const lineUp = async () => {
    setAlignment("working");
    try {
      const url = lookUrl("mid");
      const [from, to] = await Promise.all([grayPixelsOf(url), grayPixelsOf(url)]);
      const found = registerThumbnails(from, to);
      if (found === null) {
        setAlignment("none");
        return;
      }
      const centre = link.views.left ?? { x: midSize.width / 2, y: midSize.height / 2 };
      const offset = offsetFromRegistration(found, midSize, centre);
      setLink((state) => alignWithOffset(state, linkReference, "right", offset));
      setAlignment("done");
    } catch {
      setAlignment("none");
    }
  };
  const clearAlignment = () => {
    setLink((state) => alignViews(state, linkReference));
    setAlignment("idle");
  };

  const bindings = useBindings(["compare"], ["linkviews"]);
  useHotkeys(bindings, ({ action }) => {
    if (action === "linkviews") setLink((state) => toggleLinked(state, linkReference));
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pane = (side: PaneSide) => {
    const slide = slideOn(side);
    if (slide === undefined) return null;
    const outline = layers.find((row) => row.key === "outline")?.[side] ?? false;
    const wrapper: CSSProperties = {
      ...(slide.ihc ? { filter: stainFilter } : {}),
      ...(slide.flip ? { transform: "scaleX(-1)" } : {}),
    };
    return (
      <section
        data-pane={side}
        className="relative flex min-w-0 flex-1 overflow-hidden"
        aria-label={`${side === "left" ? "Left" : "Right"}: ${slide.name}`}
      >
        <div className="absolute inset-0 flex" style={wrapper}>
          <SlideStill
            view={{ kind: "whole" }}
            look="mid"
            homeOf={coverHome(midSize, [760, 520])}
            rotation={rotationOf(side)}
            overlay={({ camera }) => (
              <fieldset
                aria-label={`Rotate ${side} pane`}
                className="absolute right-3 bottom-16 m-0 flex min-w-0 border-0 items-center gap-1 rounded-full bg-black/60 px-1.5 py-1 text-body-sm text-white"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  aria-label={`Rotate ${side} pane left`}
                  className="rounded-full px-2 py-0.5 hover:bg-white/15"
                  onClick={() => rotateOn(side, camera, { by: -rotationStep })}
                >
                  ↺
                </button>
                <span data-testid={`rotation-${side}`} className="min-w-9 text-center font-mono">
                  {rotationOf(side)}°
                </span>
                <button
                  type="button"
                  aria-label={`Rotate ${side} pane right`}
                  className="rounded-full px-2 py-0.5 hover:bg-white/15"
                  onClick={() => rotateOn(side, camera, { by: rotationStep })}
                >
                  ↻
                </button>
                <button
                  type="button"
                  aria-label={`Reset ${side} pane rotation`}
                  className="rounded-full px-2 py-0.5 hover:bg-white/15"
                  onClick={() => rotateOn(side, camera, { to: 0 })}
                >
                  0°
                </button>
              </fieldset>
            )}
            camera={cameraOn(side)}
            onCameraChange={(camera) => moveCamera(side, camera)}
            regionDecisions={{}}
            bare
            minimap={false}
            hint={false}
            underlay={() =>
              outline ? (
                <path d={midEdge} fill="none" stroke="var(--c-tumor)" strokeWidth={3} />
              ) : null
            }
          />
        </div>
        <PaneHeader
          side={side}
          slide={slide}
          open={picking === side}
          onOpenChange={(open) => setPicking(open ? side : null)}
        />
        {picking === side ? (
          <PanePicker
            side={side}
            onPick={(id) => pick(side, id)}
            slides={caseSlides.map((item) => ({
              ...item,
              here: item.id === ids[side],
              note:
                item.id === ids[side]
                  ? "Showing here"
                  : item.id === ids[other(side)]
                    ? `On the ${other(side)} now, picking it swaps the sides`
                    : "Click to show here",
            }))}
          />
        ) : null}
        {cursor ? <Crosshair x="55%" y="45%" /> : null}
      </section>
    );
  };

  const left = slideOn("left");
  const right = slideOn("right");
  const body = (
    <>
      <SlidesOnScreenPanel
        left={left ? { slide: left, note: left.note } : undefined}
        right={right ? { slide: right, note: right.note } : undefined}
        onChange={setPicking}
        onSwap={swap}
      />
      <Zone
        title="Layers"
        end={<span className="font-mono text-caption text-fg-dim">Left · Right</span>}
      >
        <SideToggles
          rows={layers}
          onToggle={(key, side) =>
            setLayers(layers.map((row) => (row.key === key ? { ...row, [side]: !row[side] } : row)))
          }
        />
      </Zone>
      <Zone title="Views">
        <div className="grid gap-2.5 rounded-zone bg-chrome-2 p-3">
          <label className="flex items-center justify-between gap-2 text-body-sm">
            Move both together
            <Switch checked={linked} onCheckedChange={setLinked} />
          </label>
          <label className="flex items-center justify-between gap-2 text-body-sm">
            Shared cursor
            <Switch checked={cursor} onCheckedChange={setCursor} />
          </label>
          <SegmentedControl
            aria-label="Layout"
            fill
            value={layout}
            onValueChange={(value) => setLayout(String(value))}
            options={[
              { value: "one", label: "1" },
              { value: "side", label: "Side by side" },
              { value: "stacked", label: "Stacked" },
              { value: "four", label: "4" },
            ]}
          />
        </div>
        <div className="grid gap-1.5 rounded-zone bg-chrome-2 p-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-full bg-white/10 px-3 py-1 text-body-sm hover:bg-white/15 disabled:opacity-50"
              disabled={alignment === "working" || left === undefined || right === undefined}
              onClick={() => void lineUp()}
            >
              Line up automatically
            </button>
            {alignment === "done" ? (
              <button
                type="button"
                className="rounded-full px-3 py-1 text-body-sm text-fg-dim hover:bg-white/10"
                onClick={clearAlignment}
              >
                Clear
              </button>
            ) : null}
          </div>
          <p role="status" data-testid="alignment-status" className="m-0 text-caption text-fg-dim">
            {alignment === "working"
              ? "Comparing the two overviews"
              : alignment === "done"
                ? "Proposed from the overviews. Drag or rotate a pane to adjust."
                : alignment === "none"
                  ? "No clear match between these two. Line them up by hand."
                  : "Proposes a starting offset and rotation from the overviews."}
          </p>
        </div>
        <p className="m-0 text-caption text-fg-dim">
          The capsule question in the comments is answered on the CK level at the same spot. The
          shared cursor shows the same point on both.
        </p>
      </Zone>
    </>
  );

  return (
    <ViewerFrame
      session={session}
      counts={counts}
      tool="select"
      railGroups={reviewRail}
      onToolChange={(tool) => {
        if (tool === "select") onLeave({ scene: undefined });
      }}
      onCompare={() => setPicking("right")}
      tab="objects"
      onTabChange={(tab) => onLeave({ scene: undefined, tab: tab as "display" })}
      scene={scene}
      tabs={[
        { value: "objects", label: "Objects", count: counts.total, body },
        { value: "display", label: "Display", body: null },
        { value: "comments", label: "Comments", count: session.threads.length, body: null },
        { value: "opinion", label: "Opinion", body: null },
      ]}
    >
      <div
        className={`relative flex min-w-0 flex-1 ${layout === "stacked" ? "flex-col" : ""} gap-0.5 bg-line-strong`}
      >
        {pane("left")}
        {layout === "one" ? null : pane("right")}
        <FloatingPill className="top-auto bottom-4">
          <Icon name="slides" />
          <span>Linked: pan, zoom and rotation move both</span>
          <Switch aria-label="Linked" checked={linked} onCheckedChange={setLinked} />
          <Keycap action="linkviews" keys="⇧L" size="sm" />
        </FloatingPill>
      </div>
    </ViewerFrame>
  );
}
