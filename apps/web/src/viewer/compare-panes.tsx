import { Trans, useLingui } from "@lingui/react/macro";
import { type ProjectSlide, useGetMe, useListProjectSlides } from "@parfocal/api-client";
import { Keycap } from "@parfocal/ui/components/keycap";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Switch } from "@parfocal/ui/components/switch";
import {
  Crosshair,
  PanelSection,
  type PaneSide,
  type PaneSlide,
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
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { LiveCursor } from "../presence/live-cursor.tsx";
import { cursorSender } from "../presence/shared-cursor.ts";
import { useBlindedOn } from "../presence/use-blinded.ts";
import { useRoomCursors } from "../presence/use-room-cursors.ts";
import { okData } from "../screens/placeholder.tsx";
import type { Camera } from "../screens/review/slide-still.tsx";
import { slideThumbUrl } from "../screens/slide-thumb-url.ts";
import {
  overviewCentre,
  overviewOfShare,
  shareOfOverview,
  slideExtentOf,
} from "../screens/viewer-tools/compare-frame.ts";
import {
  type CompareLayout,
  gridOf,
  isCompareLayout,
  layoutOptions,
  panesOf,
} from "../screens/viewer-tools/compare-layout.ts";
import { useSlideOutline } from "../screens/viewer-tools/compare-outline.ts";
import {
  carryPoint,
  pointOfScreen,
  pointOnHome,
  pointOnPane,
  type SlidePoint,
  screenOfPoint,
} from "../screens/viewer-tools/cursor-map.ts";
import {
  cameraOfView,
  moveCameraKeepingRotation,
  offsetFromRegistration,
  rotatePane,
  rotationOfView,
} from "../screens/viewer-tools/link-camera.ts";
import { pickSlide, slidesToCompare } from "../screens/viewer-tools/pane-slides.ts";
import {
  pairKeyOf,
  savedOffsetOf,
  useSavedAlignments,
} from "../screens/viewer-tools/saved-alignments.ts";
import { grayPixelsOf } from "../screens/viewer-tools/thumbnail-pixels.ts";
import { useToolsLayout } from "../shell/tools-layout.ts";
import { CompareHomePane, homeCameraOf, homeFrameOf, type PaneBox } from "./compare-home.tsx";
import { CompareStillPane } from "./compare-still-pane.tsx";
import { engineCameraOf, type StillFrame } from "./still-frame.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export type CompareSlide = PaneSlide & { id: string; ihc: boolean; note: string };

export type StageCompare = {
  readonly layout: CompareLayout;
  readonly grid: string;
  readonly home: ReactNode;
  readonly panes: ReactNode;
  readonly drawn: boolean;
};

export type CompareInput = {
  readonly projectId: string;
  readonly slideId: string;
  readonly taskId: string | undefined;
  readonly reviewTaskId: string | null;
  readonly withSlideId: string | undefined;
  readonly home: ViewerEngine | null;
  readonly onShow: (change: { slideId: string; withSlideId: string | undefined }) => void;
  readonly onClose: () => void;
};

const homeSide: PaneSide = "left";

export function compareGridProps(compare: StageCompare | null) {
  if (compare === null) return { className: "contents" };
  return {
    "data-layout": compare.layout,
    "data-compare": compare.drawn ? "drawn" : "opening",
    className: `relative grid min-h-0 min-w-0 flex-1 gap-0.5 bg-line-strong ${compare.grid}`,
  };
}

function toCompareSlide(slide: ProjectSlide, note: string): CompareSlide {
  return {
    key: slide.id,
    id: slide.id,
    name: `${slide.label} · ${slide.stain}`,
    ihc: slide.stain !== "H&E",
    thumb: { backgroundImage: `url(${slideThumbUrl(slide.id)})` },
    note,
  };
}

const nearCamera = (a: Camera, b: Camera) =>
  Math.abs(a.scale / b.scale - 1) < 1e-3 && Math.hypot(a.x - b.x, a.y - b.y) * a.scale < 0.5;

export function useCompare(input: CompareInput | null): StageCompare | null {
  const on = input !== null;
  const { t } = useLingui();
  const docked = useToolsLayout() === "dock";
  const projectId = input?.projectId ?? "";
  const slideId = input?.slideId ?? "";
  const all = okData(useListProjectSlides(projectId, { query: { enabled: on } }).data) ?? [];
  const noteOf = (slide: ProjectSlide) => {
    if (slide.id === slideId) return t`The slide you were reading`;
    const stain = slide.stain;
    const caseLabel = slide.case?.label;
    return caseLabel === undefined
      ? t`${stain} stain, no case`
      : t`${stain} stain, case ${caseLabel}`;
  };
  const caseSlides = slidesToCompare(all, slideId).map((slide) =>
    toCompareSlide(slide, noteOf(slide)),
  );
  const [layout, setLayout] = useState<CompareLayout>("side");
  const [bottoms, setBottoms] = useState<{
    bottomLeft?: string | undefined;
    bottomRight?: string | undefined;
  }>({});
  const [picking, setPicking] = useState<PaneSide | null>(
    input?.withSlideId === undefined ? "right" : null,
  );
  const [options, setOptions] = useState(false);
  const [link, setLink] = useState(() =>
    createLinkedViews(["left", "right", "bottomLeft", "bottomRight"] as const),
  );
  const linked = link.linked;
  const [cursor, setCursor] = useState(true);
  const [cursorAt, setCursorAt] = useState<{ side: PaneSide; point: SlidePoint } | null>(null);
  const [outlineOn, setOutlineOn] = useState(false);
  const [frames, setFrames] = useState<Partial<Record<PaneSide, StillFrame>>>({});
  const shown = useRef<Partial<Record<PaneSide, { camera: Camera } & PaneBox>>>({});
  const visible = panesOf(layout);
  const others = caseSlides.filter((slide) => slide.id !== slideId);
  const fallbackRight = others.find((slide) => slide.ihc) ?? others[0];
  const spare = (taken: readonly (string | undefined)[]) =>
    others.find((slide) => !taken.includes(slide.id))?.id ?? others[0]?.id;
  const rightId = input?.withSlideId ?? fallbackRight?.id;
  const bottomLeftId = bottoms.bottomLeft ?? spare([rightId]);
  const bottomRightId = bottoms.bottomRight ?? spare([rightId, bottomLeftId]);
  const ids: Record<PaneSide, string | undefined> = {
    left: slideId,
    right: rightId,
    bottomLeft: bottomLeftId,
    bottomRight: bottomRightId,
  };
  const slideOn = (side: PaneSide) => caseSlides.find((slide) => slide.id === ids[side]);
  const home = input?.home ?? null;
  const homeFrame = homeFrameOf(home);
  const frameOn = (side: PaneSide) => (side === homeSide ? (homeFrame ?? undefined) : frames[side]);

  useEffect(() => {
    if (home === null) return;
    const push = () => {
      const camera = homeCameraOf(home);
      if (camera === null) return;
      setLink((state) => {
        const now = cameraOfView(state.views.left);
        if (now !== null && nearCamera(now, camera)) return state;
        return moveCameraKeepingRotation(state, homeSide, camera);
      });
    };
    push();
    return home.subscribeCamera(push);
  }, [home]);
  const homeView = link.views.left;
  useEffect(() => {
    if (home === null || homeView === null) return;
    const frame = homeFrameOf(home);
    const wanted = cameraOfView(homeView);
    const now = homeCameraOf(home);
    if (frame === null || wanted === null || now === null || nearCamera(now, wanted)) return;
    home.setCamera({ ...home.getCamera(), ...engineCameraOf(wanted, frame) });
  }, [home, homeView]);

  const reviewTaskId = input?.reviewTaskId ?? undefined;
  const rightOutline = useSlideOutline(reviewTaskId, ids.right, on && outlineOn);

  const blinded = useBlindedOn(input?.taskId, slideId);
  const { cursors: liveCursors, send: sendCursor } = useRoomCursors(
    slideId,
    okData(useGetMe().data)?.user_id,
    blinded || !on,
  );
  const [shareCursor, setShareCursor] = useState(false);
  const sendingCursor = shareCursor && !blinded && on;
  const sender = useMemo(() => cursorSender(sendCursor), [sendCursor]);
  useEffect(() => {
    if (!sendingCursor) return;
    return () => {
      sender.leave();
      sender.cancel();
    };
  }, [sendingCursor, sender]);

  const setLinked = (next: boolean) =>
    setLink((state) => (next ? relinkViews(state, homeSide) : unlinkViews(state)));

  const [alignment, setAlignment] = useState<"idle" | "working" | "done" | "none">("idle");
  const lineUp = async () => {
    setAlignment("working");
    try {
      if (ids.right === undefined) {
        setAlignment("none");
        return;
      }
      const [from, to] = await Promise.all([
        grayPixelsOf(slideThumbUrl(slideId)),
        grayPixelsOf(slideThumbUrl(ids.right)),
      ]);
      const found = registerThumbnails(from, to);
      if (found === null) {
        setAlignment("none");
        return;
      }
      const centre = link.views.left ?? overviewCentre;
      const extent = slideExtentOf(frameOn(homeSide));
      const offset = offsetFromRegistration(found, extent.size, {
        x: centre.x - extent.left,
        y: centre.y - extent.top,
      });
      setLink((state) => alignWithOffset(state, homeSide, "right", offset));
      setAlignment("done");
    } catch {
      setAlignment("none");
    }
  };
  const clearAlignment = () => {
    setLink((state) => alignViews(state, homeSide));
    setAlignment("idle");
  };

  const pairKey = pairKeyOf(slideId, ids.right);
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
        ? alignWithOffset(state, homeSide, "right", stored)
        : isNoOffset(state.offsets.right)
          ? state
          : alignViews(state, homeSide),
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
    if (on && action === "linkviews") setLink((state) => toggleLinked(state, homeSide));
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (input === null) return null;

  const openPicker = (side: PaneSide | null) => {
    if (side !== null) setOptions(false);
    setPicking(side);
  };
  const pick = (side: PaneSide, id: string) => {
    setPicking(null);
    const next = pickSlide(ids, side, id, visible);
    if (side === "bottomLeft" || side === "bottomRight") {
      setBottoms({ bottomLeft: next.bottomLeft, bottomRight: next.bottomRight });
    }
    if (next.left !== slideId || next.right !== input.withSlideId) {
      input.onShow({ slideId: next.left ?? slideId, withSlideId: next.right });
    }
  };
  const swap = () => {
    setPicking(null);
    if (ids.right !== undefined) input.onShow({ slideId: ids.right, withSlideId: slideId });
  };
  const pickerSlides = (side: PaneSide) =>
    caseSlides.map((item) => {
      const there = visible.find((other) => other !== side && ids[other] === item.id);
      return {
        ...item,
        here: item.id === ids[side],
        note:
          item.id === ids[side]
            ? t`Showing here`
            : there === undefined
              ? t`Click to show here`
              : t`Shown on another side now, picking it swaps the sides`,
      };
    });
  const viewOn = (side: PaneSide, camera: Camera): LinkedView => ({
    x: camera.x,
    y: camera.y,
    zoom: Math.log2(camera.scale),
    rotation: side === homeSide ? 0 : rotationOfView(link.views[side]),
  });
  const onPointer = (
    side: PaneSide,
    camera: Camera,
    box: PaneBox,
    at: { x: number; y: number },
  ) => {
    shown.current[side] = { camera, ...box };
    if (!cursor && !sendingCursor) return;
    const point = pointOfScreen(viewOn(side, camera), box, at);
    if (cursor) setCursorAt({ side, point });
    if (sendingCursor) {
      sender.move(
        shareOfOverview(pointOnHome(point, side, homeSide, link.offsets), frameOn(homeSide)),
      );
    }
  };
  const cursorOn = (side: PaneSide, camera: Camera, box: PaneBox) => {
    shown.current[side] = { camera, ...box };
    if (!cursor) return null;
    const own = viewOn(side, camera);
    const source = cursorAt ?? {
      side: homeSide,
      point: pointOfScreen(link.views.left ?? own, box, {
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

  const homeSlide = slideOn(homeSide);
  const homePane = (
    <CompareHomePane
      engine={home}
      link={{
        slide: homeSlide,
        picking: picking === homeSide,
        pickerSlides: pickerSlides(homeSide),
        onPicking: (open) => openPicker(open ? homeSide : null),
        onPick: (id) => pick(homeSide, id),
        onPointer: (camera, box, at) =>
          at === null ? undefined : onPointer(homeSide, camera, box, at),
        overlay: (camera, box) => cursorOn(homeSide, camera, box),
      }}
    />
  );
  const stillSides = visible.filter((side) => side !== homeSide);
  const slots = visible.flatMap((side) => {
    const slide = slideOn(side);
    return slide ? [{ side, slide, note: slide.note }] : [];
  });
  const drawn =
    home !== null &&
    homeFrame !== null &&
    stillSides.every((side) => slideOn(side) === undefined || frames[side] !== undefined);
  const controls = (
    <section
      aria-label={t`Compare options`}
      className="absolute top-3 right-3 z-20 grid max-h-[calc(100%-1.5rem)] w-80 gap-3 overflow-y-auto rounded-zone border border-line bg-chrome p-3 shadow-pop"
    >
      <SlidesOnScreenPanel slots={slots} onChange={openPicker} onSwap={swap} />
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
          <label className="flex items-center justify-between gap-2 text-body-sm">
            <Trans>Tumor map outline on the right</Trans>
            <Switch
              aria-label={t`Tumor map outline on the right`}
              title={rightOutline.available === false ? t`This slide has no tumor map` : undefined}
              disabled={rightOutline.available === false}
              checked={outlineOn && rightOutline.available !== false}
              onCheckedChange={setOutlineOn}
            />
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
                alignment === "working" || layout === "one" || slideOn("right") === undefined
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
      </PanelSection>
    </section>
  );
  const panes = (
    <>
      {stillSides.map((side) => {
        const slide = slideOn(side);
        if (slide === undefined) return <div key={side} data-pane={side} className="bg-canvas" />;
        const outline = side === "right" && outlineOn ? rightOutline : null;
        return (
          <CompareStillPane
            key={side}
            side={side}
            slide={slide}
            camera={cameraOfView(link.views[side])}
            rotation={rotationOfView(link.views[side])}
            objects={outline?.available === true ? outline.objects : null}
            picking={picking === side}
            pickerSlides={pickerSlides(side)}
            onPicking={(open) => openPicker(open ? side : null)}
            onPick={(id) => pick(side, id)}
            onCamera={(camera) =>
              setLink((state) => moveCameraKeepingRotation(state, side, camera))
            }
            onRotate={(camera, change) =>
              setLink((state) => {
                if (!state.linked) return rotatePane(state, side, camera, change);
                return relinkViews(rotatePane(unlinkViews(state), side, camera, change), homeSide);
              })
            }
            onFrame={(frame) =>
              setFrames((known) => (known[side] === frame ? known : { ...known, [side]: frame }))
            }
            onPointer={(camera, box, at) => onPointer(side, camera, box, at)}
            overlay={(camera, box) => cursorOn(side, camera, box)}
          />
        );
      })}
      {options ? controls : null}
      <div
        data-slot="floating-pill"
        className={`absolute ${docked ? "bottom-[4.75rem]" : "bottom-4"} left-1/2 z-20 flex min-h-8 -translate-x-1/2 items-center gap-3 rounded-[10px] border border-line bg-chrome px-3 py-1.25 text-caption whitespace-nowrap shadow-pop`}
        onPointerLeave={() => sender.leave()}
      >
        <span>
          <Trans>Linked: pan, zoom and rotation move both</Trans>
        </span>
        <Switch aria-label={t`Linked`} checked={linked} onCheckedChange={setLinked} />
        <Keycap action="linkviews" keys="⇧L" size="sm" />
        {blinded ? null : (
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
        )}
        <button
          type="button"
          aria-expanded={options}
          className="min-h-6 rounded-full px-2 py-0.5 hover:bg-white/10"
          onClick={() => setOptions((open) => !open)}
        >
          <Trans>Compare options</Trans>
        </button>
        <button
          type="button"
          className="min-h-6 rounded-full px-2 py-0.5 hover:bg-white/10"
          onClick={input.onClose}
        >
          <Trans>Close compare</Trans>
        </button>
      </div>
    </>
  );
  return {
    layout,
    grid: gridOf(layout),
    home: homePane,
    panes,
    drawn,
  };
}
