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
  isNoOffset,
  type LinkedView,
  registerThumbnails,
  relinkViews,
  toggleLinked,
  unlinkViews,
} from "@parfocal/viewer-engine";
import {
  type CSSProperties,
  Fragment,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useBindings } from "../../keys/personal-keys.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { okData } from "../placeholder.tsx";
import { type Camera, midSize, SlideStill } from "../review/slide-still.tsx";
import { ViewerFrame } from "../review/viewer-frame.tsx";
import type { SceneOf } from "../scenes.ts";
import { lookUrl } from "../thumbnails.ts";
import {
  assignSlides,
  type CompareLayout,
  gridOf,
  isCompareLayout,
  layerSideOf,
  layoutOptions,
  paneName,
  paneSides,
  panesOf,
} from "./compare-layout.ts";
import { carryPoint, pointOfScreen, type SlidePoint, screenOfPoint } from "./cursor-map.ts";
import {
  cameraOfView,
  moveCameraKeepingRotation,
  offsetFromRegistration,
  rotatePane,
  rotationOfView,
  rotationStep,
} from "./link-camera.ts";
import { type PaneSlideIds, pickSlide, swapSlides } from "./pane-slides.ts";
import { reviewRail } from "./rails.ts";
import { pairKeyOf, savedOffsetOf, useSavedAlignments } from "./saved-alignments.ts";
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

const linkReference: PaneSide = "left";

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
  const [chosen, setChosen] = useState<Partial<Record<PaneSide, string | null | undefined>>>({
    left: null,
    right: rightSlideId ?? null,
  });
  const [picking, setPicking] = useState<PaneSide | null>(scene === "picking" ? "right" : null);
  const [link, setLink] = useState(() => createLinkedViews(paneSides));
  const linked = link.linked;
  const [cursor, setCursor] = useState(true);
  const [cursorAt, setCursorAt] = useState<{ side: PaneSide; point: SlidePoint } | null>(null);
  const shown = useRef<
    Partial<Record<PaneSide, { camera: Camera; width: number; height: number }>>
  >({});
  const [layout, setLayout] = useState<CompareLayout>("side");
  const [layers, setLayers] = useState([
    { key: "outline", name: "Tumor map outline", left: true, right: false },
    { key: "measurements", name: "Measurements", left: true, right: false },
    { key: "comments", name: "Comments", left: true, right: true },
  ]);
  const fallbackRight = caseSlides.find((slide) => slide.ihc) ?? caseSlides[1];
  const visible = panesOf(layout);
  const ids = assignSlides(
    caseSlides.map((slide) => slide.id),
    chosen,
    { left: session.slideId, right: fallbackRight?.id },
  );
  const slideOn = (side: PaneSide) => caseSlides.find((slide) => slide.id === ids[side]);
  const show = (next: PaneSlideIds) => setChosen({ ...next });
  const pick = (side: PaneSide, id: string) => {
    show(pickSlide(ids, side, id, visible));
    setPicking(null);
  };
  const swap = () => {
    show(swapSlides(ids));
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

  const pairKey = pairKeyOf(ids.left, ids.right);
  const {
    ready: alignmentsReady,
    saved: savedAlignments,
    save: saveAlignment,
  } = useSavedAlignments();
  const savedNow = useRef(savedAlignments);
  savedNow.current = savedAlignments;
  const [settledPair, setSettledPair] = useState<string | null>(null);
  useEffect(() => {
    if (!alignmentsReady || pairKey === null) return;
    const stored = savedOffsetOf(savedNow.current, pairKey);
    setLink((state) =>
      stored !== null
        ? alignWithOffset(state, linkReference, "right", stored)
        : isNoOffset(state.offsets.right)
          ? state
          : alignViews(state, linkReference),
    );
    setAlignment("idle");
    setSettledPair(pairKey);
  }, [alignmentsReady, pairKey]);
  const offsetRight = link.offsets.right;
  useEffect(() => {
    if (settledPair === null || settledPair !== pairKey) return;
    saveAlignment(pairKey, isNoOffset(offsetRight) ? null : offsetRight);
  }, [settledPair, pairKey, offsetRight, saveAlignment]);
  const aligned = !isNoOffset(offsetRight);

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

  const pickerNote = (id: string, side: PaneSide) => {
    if (id === ids[side]) return "Showing here";
    const there = visible.find((other) => other !== side && ids[other] === id);
    return there === undefined
      ? "Click to show here"
      : `On the ${paneName[there]} now, picking it swaps the panes`;
  };

  const viewOn = (side: PaneSide, camera: Camera): LinkedView => ({
    x: camera.x,
    y: camera.y,
    zoom: Math.log2(camera.scale),
    rotation: rotationOf(side),
  });
  const onPaneMove = (side: PaneSide, flip: boolean, event: PointerEvent<HTMLElement>) => {
    const last = shown.current[side];
    if (!cursor || last === undefined) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = pointOfScreen(
      viewOn(side, last.camera),
      last,
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      flip,
    );
    setCursorAt({ side, point });
  };
  const cursorOn = (side: PaneSide, camera: Camera, box: { width: number; height: number }) => {
    shown.current[side] = { camera, ...box };
    if (!cursor) return null;
    const own = viewOn(side, camera);
    const source = cursorAt ?? {
      side: linkReference,
      point: pointOfScreen(link.views[linkReference] ?? own, box, {
        x: box.width * 0.55,
        y: box.height * 0.45,
      }),
    };
    const point =
      source.side === side
        ? source.point
        : carryPoint(source.point, link.offsets[source.side], link.offsets[side]);
    const at = screenOfPoint(own, box, point);
    return <Crosshair x={at.x} y={at.y} />;
  };

  const pane = (side: PaneSide) => {
    const slide = slideOn(side);
    if (slide === undefined) return null;
    const outline = layers.find((row) => row.key === "outline")?.[layerSideOf(side)] ?? false;
    const wrapper: CSSProperties = {
      ...(slide.ihc ? { filter: stainFilter } : {}),
      ...(slide.flip ? { transform: "scaleX(-1)" } : {}),
    };
    return (
      <section
        data-pane={side}
        className="relative flex min-h-0 min-w-0 overflow-hidden"
        aria-label={`${paneName[side][0]?.toUpperCase()}${paneName[side].slice(1)}: ${slide.name}`}
        onPointerMove={(event) => onPaneMove(side, slide.flip, event)}
      >
        <div className="absolute inset-0 flex" style={wrapper}>
          <SlideStill
            view={{ kind: "whole" }}
            look="mid"
            homeOf={coverHome(midSize, [760, 520])}
            rotation={rotationOf(side)}
            overlay={({ camera, size }) => (
              <>
                {cursorOn(side, camera, size)}
                <fieldset
                  aria-label={`Rotate ${paneName[side]} pane`}
                  className="absolute right-3 bottom-16 m-0 flex min-w-0 border-0 items-center gap-1 rounded-full bg-black/60 px-1.5 py-1 text-body-sm text-white"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    aria-label={`Rotate ${paneName[side]} pane left`}
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
                    aria-label={`Rotate ${paneName[side]} pane right`}
                    className="rounded-full px-2 py-0.5 hover:bg-white/15"
                    onClick={() => rotateOn(side, camera, { by: rotationStep })}
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    aria-label={`Reset ${paneName[side]} pane rotation`}
                    className="rounded-full px-2 py-0.5 hover:bg-white/15"
                    onClick={() => rotateOn(side, camera, { to: 0 })}
                  >
                    0°
                  </button>
                </fieldset>
              </>
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
              note: pickerNote(item.id, side),
            }))}
          />
        ) : null}
      </section>
    );
  };

  const slots = visible.flatMap((side) => {
    const slide = slideOn(side);
    return slide ? [{ side, slide, note: slide.note }] : [];
  });
  const body = (
    <>
      <SlidesOnScreenPanel
        slots={slots}
        onChange={setPicking}
        onSwap={visible.length > 1 ? swap : undefined}
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
            onValueChange={(value) => {
              const next = String(value);
              if (!isCompareLayout(next)) return;
              setLayout(next);
              setPicking(null);
            }}
            options={[...layoutOptions]}
          />
        </div>
        <div className="grid gap-1.5 rounded-zone bg-chrome-2 p-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-full bg-white/10 px-3 py-1 text-body-sm hover:bg-white/15 disabled:opacity-50"
              disabled={
                alignment === "working" ||
                layout === "one" ||
                slideOn("left") === undefined ||
                slideOn("right") === undefined
              }
              onClick={() => void lineUp()}
            >
              Line up automatically
            </button>
            {alignment === "done" || aligned ? (
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
                : aligned
                  ? "Your alignment is kept for this pair of slides. Clear puts the panes back."
                  : alignment === "none"
                    ? "No clear match between these two. Line them up by hand."
                    : layout === "four"
                      ? "Lines the right pane up with the left. The two bottom panes keep their own view."
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
        data-layout={layout}
        className={`relative grid min-h-0 min-w-0 flex-1 gap-0.5 bg-line-strong ${gridOf(layout)}`}
      >
        {visible.map((side) => (
          <Fragment key={side}>{pane(side)}</Fragment>
        ))}
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
