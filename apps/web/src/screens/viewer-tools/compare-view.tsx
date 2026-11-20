import { Trans, useLingui } from "@lingui/react/macro";
import {
  type ProjectSlide,
  useGetMe,
  useGetReviewTask,
  useListProjectSlides,
} from "@parfocal/api-client";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Switch } from "@parfocal/ui/components/switch";
import {
  Crosshair,
  FloatingPill,
  PaneHeader,
  PanelSection,
  PanePicker,
  type PaneSide,
  type PaneSlide,
  SideToggles,
  SlidesOnScreenPanel,
} from "@parfocal/ui/components/viewer-tools";
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
import { useNavigate } from "@tanstack/react-router";
import { Fragment, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useBindings } from "../../keys/personal-keys.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { LiveCursor } from "../../presence/live-cursor.tsx";
import { cursorSender } from "../../presence/shared-cursor.ts";
import { useBlindedOn } from "../../presence/use-blinded.ts";
import { useRoomCursors } from "../../presence/use-room-cursors.ts";
import { useToolsLayout } from "../../shell/tools-layout.ts";
import { LiveTopBar } from "../../viewer/live-top-bar.tsx";
import { useStageTabCounts } from "../../viewer/stage-tab-counts.ts";
import {
  type StillDrawChoices,
  StillEngine,
  type StillLink,
  type StillObject,
} from "../../viewer/still-engine.tsx";
import type { StillFrame } from "../../viewer/still-frame.ts";
import { useCaseLoad } from "../../viewer/use-case-load.ts";
import { useWebglAvailable } from "../../viewer/webgl.ts";
import type { SlideWorkspace } from "../../viewer/workspace.ts";
import { okData } from "../placeholder.tsx";
import { type Camera, SlideStill } from "../review/slide-still.tsx";
import { ObjectsSummary, ViewerFrame } from "../review/viewer-frame.tsx";
import type { SceneOf } from "../scenes.ts";
import { slideThumbUrl } from "../slide-thumb-url.ts";
import {
  overviewCentre,
  overviewOfShare,
  shareOfOverview,
  slideExtentOf,
  turnedHost,
} from "./compare-frame.ts";
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
import { type SlideOutline, useSlideOutline } from "./compare-outline.ts";
import {
  carryPoint,
  pointOfScreen,
  pointOnHome,
  pointOnPane,
  type SlidePoint,
  screenOfPoint,
} from "./cursor-map.ts";
import {
  cameraOfView,
  moveCameraKeepingRotation,
  offsetFromRegistration,
  rotatePane,
  rotationOfView,
  rotationStep,
} from "./link-camera.ts";
import { type PaneSlideIds, pickSlide, slidesToCompare, swapSlides } from "./pane-slides.ts";
import { reviewRail } from "./rails.ts";
import { pairKeyOf, savedOffsetOf, useSavedAlignments } from "./saved-alignments.ts";
import { grayPixelsOf } from "./thumbnail-pixels.ts";
import type { ToolSession } from "./tool-session.tsx";

type CompareSlide = PaneSlide & { id: string; ihc: boolean; note: string };

const plainSlide: StillDrawChoices = {
  draw: "outline",
  width: "normal",
  opacity: 1,
  colorBy: "class",
  cutoff: 0,
  confidence: "all",
};

function toCompareSlide(slide: ProjectSlide, currentId: string): CompareSlide {
  const ihc = slide.stain !== "H&E";
  return {
    key: slide.id,
    id: slide.id,
    name: `${slide.label} · ${slide.stain}`,
    ihc,
    thumb: { backgroundImage: `url(${slideThumbUrl(slide.id)})` },
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
  projectId: string;
  slideId: string;
  taskId: string | undefined;
  workspace: SlideWorkspace | undefined;
  tools: ToolSession | null;
  scene: SceneOf<"compare">;
  rightSlideId?: string | undefined;
  onLeave: (change: {
    scene?: undefined;
    tab?: "objects" | "display" | "comments" | "opinion";
  }) => void;
};

export function CompareView({
  projectId,
  slideId,
  taskId,
  workspace,
  tools,
  scene,
  rightSlideId,
  onLeave,
}: CompareViewProps) {
  const { t } = useLingui();
  const docked = useToolsLayout() === "dock";
  const counts = tools?.counts;
  const navigate = useNavigate();
  const all = okData(useListProjectSlides(projectId).data) ?? [];
  const loaded = useCaseLoad(projectId, slideId, taskId);
  const load = loaded.state === "ready" ? loaded.load : null;
  const taskDetail = okData(
    useGetReviewTask(taskId ?? "", { query: { enabled: taskId !== undefined } }).data,
  );
  const reviewTaskId = taskDetail?.kind === "review" ? taskId : undefined;
  const tabCounts = useStageTabCounts({
    projectId,
    taskId,
    reviewTaskId: reviewTaskId ?? null,
    slideId,
  });
  const backToViewer = (change: {
    slideId?: string;
    workspace?: SlideWorkspace;
    tab?: "opinion" | "display";
  }) =>
    void navigate({
      to: "/projects/$projectId/slides/$slideId",
      params: { projectId, slideId: change.slideId ?? slideId },
      search: {
        task: taskId,
        workspace: change.workspace ?? workspace,
        ...(change.tab ? { tab: change.tab } : {}),
      },
    });
  const caseSlides = slidesToCompare(all, slideId).map((slide) => toCompareSlide(slide, slideId));
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
  const webgl = useWebglAvailable();
  const [frames, setFrames] = useState<Partial<Record<PaneSide, StillFrame>>>({});
  const frameOn = (side: PaneSide | undefined) => (side === undefined ? undefined : frames[side]);
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
    { left: slideId, right: fallbackRight?.id },
  );
  const outlineWanted = (side: PaneSide) =>
    layers.find((row) => row.key === "outline")?.[layerSideOf(side)] ?? false;
  const outlines = {
    left: useSlideOutline(reviewTaskId, ids.left, outlineWanted("left")),
    right: useSlideOutline(reviewTaskId, ids.right, outlineWanted("right")),
    bottomLeft: useSlideOutline(reviewTaskId, ids.bottomLeft, outlineWanted("bottomLeft")),
    bottomRight: useSlideOutline(reviewTaskId, ids.bottomRight, outlineWanted("bottomRight")),
  } satisfies Record<PaneSide, SlideOutline>;
  const noOutline = t`This slide has no tumor map`;
  const layerRows = layers.map((row) => {
    if (row.key !== "outline") return row;
    const unavailable = Object.fromEntries(
      (["left", "right"] as const)
        .filter((side) => outlines[side].available === false)
        .map((side) => [side, noOutline]),
    );
    return { ...row, unavailable };
  });
  const blinded = useBlindedOn(taskId, slideId);
  const { cursors: liveCursors, send: sendCursor } = useRoomCursors(
    slideId,
    okData(useGetMe().data)?.user_id,
    blinded,
  );
  const homeSide = paneSides.find((side) => ids[side] === slideId);
  const [shareCursor, setShareCursor] = useState(false);
  const canShareCursor = !blinded && homeSide !== undefined;
  const sendingCursor = shareCursor && canShareCursor;
  const sender = useMemo(() => cursorSender(sendCursor), [sendCursor]);
  useEffect(() => {
    if (!sendingCursor) return;
    return () => {
      sender.leave();
      sender.cancel();
    };
  }, [sendingCursor, sender]);
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
      if (ids.left === undefined || ids.right === undefined) {
        setAlignment("none");
        return;
      }
      const [from, to] = await Promise.all([
        grayPixelsOf(slideThumbUrl(ids.left)),
        grayPixelsOf(slideThumbUrl(ids.right)),
      ]);
      const found = registerThumbnails(from, to);
      if (found === null) {
        setAlignment("none");
        return;
      }
      const centre = link.views.left ?? overviewCentre;
      const extent = slideExtentOf(frameOn("left"));
      const offset = offsetFromRegistration(found, extent.size, {
        x: centre.x - extent.left,
        y: centre.y - extent.top,
      });
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
      : `On the ${paneName[there]} now, picking it swaps the sides`;
  };

  const viewOn = (side: PaneSide, camera: Camera): LinkedView => ({
    x: camera.x,
    y: camera.y,
    zoom: Math.log2(camera.scale),
    rotation: rotationOf(side),
  });
  const onPaneMove = (side: PaneSide, event: PointerEvent<HTMLElement>) => {
    const last = shown.current[side];
    if ((!cursor && !sendingCursor) || last === undefined) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = pointOfScreen(viewOn(side, last.camera), last, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    if (cursor) setCursorAt({ side, point });
    if (sendingCursor && homeSide !== undefined) {
      sender.move(
        shareOfOverview(pointOnHome(point, side, homeSide, link.offsets), frameOn(homeSide)),
      );
    }
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
    return (
      <>
        <Crosshair x={at.x} y={at.y} />
        {liveCursors.map((live) => {
          const carried = pointOnPane(
            overviewOfShare(live.at, frameOn(homeSide)),
            homeSide,
            side,
            link.offsets,
          );
          if (carried === null) return null;
          const spot = screenOfPoint(own, box, carried);
          return <LiveCursor key={live.user} x={spot.x} y={spot.y} user={live.user} />;
        })}
      </>
    );
  };

  const pane = (side: PaneSide) => {
    const slide = slideOn(side);
    if (slide === undefined) return null;
    const rotation = rotationOf(side);
    const outline = outlineWanted(side) && outlines[side].available === true;
    return (
      <section
        data-pane={side}
        className="relative flex min-h-0 min-w-0 overflow-hidden"
        aria-label={`${paneName[side][0]?.toUpperCase()}${paneName[side].slice(1)}: ${slide.name}`}
        onPointerMove={(event) => onPaneMove(side, event)}
      >
        <div className="absolute inset-0 flex">
          <SlideStill
            view={{ kind: "whole" }}
            rotation={rotation}
            backdrop={
              webgl
                ? ({ camera, size, onReady, onTiles }) => (
                    <div
                      data-testid="engine-turn"
                      data-rotation={rotation}
                      className="pointer-events-none absolute"
                      style={turnedHost(rotation, size)}
                    >
                      <PaneEngine
                        key={slide.id}
                        slideId={slide.id}
                        objects={outline ? outlines[side].objects : null}
                        camera={camera}
                        onReady={(ready) => {
                          onReady(ready);
                          setFrames((known) => frameKept(known, side, ready?.frame));
                        }}
                        onTiles={onTiles}
                      />
                    </div>
                  )
                : undefined
            }
            overlay={({ camera, size }) => (
              <>
                {cursorOn(side, camera, size)}
                <fieldset
                  aria-label={t`Rotate ${paneName[side]} pane`}
                  className="absolute right-3 bottom-16 m-0 flex min-w-0 border-0 items-center gap-1 rounded-full bg-black/60 px-1.5 py-1 text-body-sm text-white"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    aria-label={t`Rotate ${paneName[side]} pane left`}
                    className="min-h-6 min-w-6 rounded-full px-2 py-0.5 hover:bg-white/15"
                    onClick={() => rotateOn(side, camera, { by: -rotationStep })}
                  >
                    ↺
                  </button>
                  <span data-testid={`rotation-${side}`} className="min-w-9 text-center font-mono">
                    {rotationOf(side)}°
                  </span>
                  <button
                    type="button"
                    aria-label={t`Rotate ${paneName[side]} pane right`}
                    className="min-h-6 min-w-6 rounded-full px-2 py-0.5 hover:bg-white/15"
                    onClick={() => rotateOn(side, camera, { by: rotationStep })}
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    aria-label={t`Reset ${paneName[side]} pane rotation to 0°`}
                    className="min-h-6 min-w-6 rounded-full px-2 py-0.5 hover:bg-white/15"
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
  const slideLabel = load?.slide?.label ?? tools?.session.slideName.split(" · ")[0] ?? "";
  const body = (
    <>
      {tools === null ? null : (
        <ObjectsSummary
          slideLabel={slideLabel}
          counts={tools.counts}
          added={tools.session.added.map((item) => item.object)}
        />
      )}
      <SlidesOnScreenPanel
        slots={slots}
        onChange={setPicking}
        onSwap={visible.length > 1 ? swap : undefined}
      />
      <PanelSection
        title={t`Layers`}
        end={
          <span className="font-mono text-caption text-fg-dim">
            <Trans>Left · Right</Trans>
          </span>
        }
      >
        <SideToggles
          rows={layerRows}
          onToggle={(key, side) =>
            setLayers(layers.map((row) => (row.key === key ? { ...row, [side]: !row[side] } : row)))
          }
        />
      </PanelSection>
      <PanelSection title={t`Views`}>
        <div className="grid gap-2.5 rounded-zone bg-chrome-2 p-3">
          <label className="flex items-center justify-between gap-2 text-body-sm">
            <Trans>Move both together</Trans>
            <Switch checked={linked} onCheckedChange={setLinked} />
          </label>
          <label className="flex items-center justify-between gap-2 text-body-sm">
            <Trans>Shared cursor</Trans>
            <Switch checked={cursor} onCheckedChange={setCursor} />
          </label>
          <SegmentedControl
            aria-label={t`Layout`}
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
              <Trans>Line up automatically</Trans>
            </button>
            {alignment === "done" || aligned ? (
              <button
                type="button"
                className="rounded-full px-3 py-1 text-body-sm text-fg-dim hover:bg-white/10"
                onClick={clearAlignment}
              >
                <Trans>Clear</Trans>
              </button>
            ) : null}
          </div>
          <p role="status" data-testid="alignment-status" className="m-0 text-caption text-fg-dim">
            {alignment === "working"
              ? t`Comparing the two overviews`
              : alignment === "done"
                ? t`Proposed from the overviews. Drag or rotate a pane to adjust.`
                : aligned
                  ? t`Your alignment is kept for this pair of slides. Clear puts the panes back.`
                  : alignment === "none"
                    ? t`No clear match between these two. Line them up by hand.`
                    : layout === "four"
                      ? t`Lines the right pane up with the left. The two bottom panes keep their own view.`
                      : t`Proposes a starting offset and rotation from the overviews.`}
          </p>
        </div>
        <p className="m-0 text-caption text-fg-dim">
          <Trans>
            The capsule question in the comments is answered on the CK level at the same spot. The
            shared cursor shows the same point on both.
          </Trans>
        </p>
      </PanelSection>
    </>
  );

  return (
    <ViewerFrame
      counts={counts}
      tool="select"
      topBar={
        <LiveTopBar
          projectId={projectId}
          slideId={slideId}
          load={load}
          task={taskDetail}
          workspace={workspace ?? "review"}
          onWorkspace={(next) => backToViewer({ workspace: next })}
          onOpenSlide={(next) => backToViewer({ slideId: next })}
          onSubmit={() => backToViewer({ tab: "opinion" })}
          onResultSets={() => backToViewer({ tab: "display" })}
          percent={null}
          objectTotal={0}
          onPeek={() => backToViewer({})}
          statusRef={() => undefined}
          storage={null}
        />
      }
      railGroups={reviewRail}
      onToolChange={(tool) => {
        if (tool === "select") onLeave({ scene: undefined });
      }}
      onCompare={() => setPicking("right")}
      tab="objects"
      onTabChange={(tab) => onLeave({ scene: undefined, tab: tab as "display" })}
      scene={scene}
      tabs={[
        {
          value: "objects",
          label: "Objects",
          count: counts?.total ?? tabCounts.objects ?? 0,
          body,
        },
        { value: "display", label: "Display", body: null },
        { value: "comments", label: "Comments", count: tabCounts.comments ?? 0, body: null },
        { value: "opinion", label: "Opinion", body: null },
      ]}
    >
      <div
        data-layout={layout}
        onPointerLeave={() => sender.leave()}
        className={`relative grid min-h-0 min-w-0 flex-1 gap-0.5 bg-line-strong ${gridOf(layout)}`}
      >
        {visible.map((side) => (
          <Fragment key={side}>{pane(side)}</Fragment>
        ))}
        <FloatingPill
          className={`min-h-8 ${docked ? "top-auto bottom-[4.75rem]" : "top-auto bottom-4"}`}
        >
          <Icon name="slides" />
          <span>
            <Trans>Linked: pan, zoom and rotation move both</Trans>
          </span>
          <Switch aria-label={t`Linked`} checked={linked} onCheckedChange={setLinked} />
          <Keycap action="linkviews" keys="⇧L" size="sm" />
          {canShareCursor ? (
            <>
              <span>
                <Trans>Share my cursor</Trans>
              </span>
              <Switch
                aria-label={t`Share my cursor`}
                data-testid="share-cursor"
                title={
                  shareCursor
                    ? t`Others on this slide see where you point. Click to stop`
                    : t`Let others on this slide see where you point`
                }
                checked={shareCursor}
                onCheckedChange={setShareCursor}
              />
            </>
          ) : null}
        </FloatingPill>
      </div>
    </ViewerFrame>
  );
}

const noClasses: ReadonlySet<string> = new Set();

function PaneEngine({
  slideId,
  objects,
  camera,
  onReady,
  onTiles,
}: {
  slideId: string;
  objects: readonly StillObject[] | null;
  camera: Camera;
  onReady: (link: StillLink | null) => void;
  onTiles: (failed: number) => void;
}) {
  return (
    <StillEngine
      slideId={slideId}
      camera={camera}
      objects={objects}
      choices={plainSlide}
      hiddenClasses={noClasses}
      onReady={onReady}
      onTiles={onTiles}
    />
  );
}

function frameKept(
  known: Partial<Record<PaneSide, StillFrame>>,
  side: PaneSide,
  frame: StillFrame | undefined,
): Partial<Record<PaneSide, StillFrame>> {
  if (known[side] === frame) return known;
  const { [side]: _gone, ...rest } = known;
  return frame === undefined ? rest : { ...rest, [side]: frame };
}
