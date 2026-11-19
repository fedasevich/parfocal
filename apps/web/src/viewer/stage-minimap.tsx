import { useLingui } from "@lingui/react/macro";
import { useListDecisions, useListReviewObjects } from "@parfocal/api-client";
import { MapViewport, SmartMinimap } from "@parfocal/ui/components/smart-minimap";
import {
  type MapRect,
  type MinimapSetting,
  type MinimapSize,
  minimapBox,
} from "@parfocal/ui/lib/minimap-box";
import { useMinimap } from "@parfocal/ui/lib/use-minimap";
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openPopout, useMainPopoutSync } from "../popout/popout-channel.ts";
import { okData } from "../screens/placeholder.tsx";
import { slideThumbUrl } from "../screens/slide-thumb-url.ts";
import {
  type Corner,
  type CornerChoice,
  choiceOfCorner,
  chosenPlacement,
  cornerOfChoice,
  cornerOfPoint,
  fitsCanvas,
  pinnedMinimap,
  placeMinimap,
  type ScreenRect,
  stepCorner,
} from "../screens/viewer-tools/minimap-placement.ts";
import { tissueShareOnScreen } from "../screens/viewer-tools/tissue-share.ts";
import { useHeldCorner } from "../screens/viewer-tools/use-held-corner.tsx";
import {
  type CornerChoiceUpdate,
  type MinimapSurface,
  useMinimapCorner,
} from "../screens/viewer-tools/use-minimap-corner.ts";
import { useResolvedSettings } from "../shell/resolved-settings.ts";
import type { ViewerModule } from "./magnification-control.tsx";
import { viewportRect } from "./stage-geometry.ts";
import type { StageSession } from "./stage-inspector.tsx";
import type { SlideOverview, ViewerEngine } from "./viewer-engine.ts";

function overviewUrl(overview: SlideOverview): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = overview.width;
  canvas.height = overview.height;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.putImageData(new ImageData(overview.rgba, overview.width, overview.height), 0, 0);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export type MinimapSource = "thumbnail" | "overview" | "none";

export function useMinimapImage(slideId: string, overview: StageSession["overview"] | undefined) {
  const [image, setImage] = useState<{ src: string | null; source: MinimapSource } | null>(null);
  useEffect(() => {
    const stop = new AbortController();
    const thumbnail = slideThumbUrl(slideId);
    const fallBack = async () => {
      const read = overview === undefined ? null : await overview(stop.signal).catch(() => null);
      const src = read === null ? null : overviewUrl(read);
      if (!stop.signal.aborted) setImage({ src, source: src === null ? "none" : "overview" });
    };
    fetch(thumbnail, { credentials: "same-origin", signal: stop.signal })
      .then((response) => {
        if (response.ok) setImage({ src: thumbnail, source: "thumbnail" });
        else void fallBack();
      })
      .catch(() => {
        if (!stop.signal.aborted) void fallBack();
      });
    return () => stop.abort();
  }, [slideId, overview]);
  return image;
}

const landingCorners: Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

const blockSelector = [
  '[data-testid="stage-cells-grid"]',
  '[data-testid="area-nav"]',
  '[data-testid="travel-minimap"]',
  '[data-testid="cell-type-bar"]',
  '[data-slot="stage-tools"]',
  '[data-slot="magnification-bar"]',
  "[data-minimap-block]",
].join(",");

const sameRects = (a: ScreenRect[], b: ScreenRect[]) =>
  a.length === b.length && a.every((rect, index) => rect.join() === b[index]?.join());

export function useStageBlocks(
  frame: React.RefObject<HTMLElement | null>,
  selector: string = blockSelector,
): ScreenRect[] {
  const [blocks, setBlocks] = useState<ScreenRect[]>([]);
  useEffect(() => {
    const node = frame.current;
    const host = node?.closest<HTMLElement>('[data-testid="slide-stage"]') ?? node?.parentElement;
    if (!node || !host) return;
    const watched = new Set<HTMLElement>();
    const measure = () => {
      const origin = node.getBoundingClientRect();
      const elements = [...host.querySelectorAll<HTMLElement>(selector)].filter(
        (element) => !node.contains(element),
      );
      for (const element of watched) {
        if (!elements.includes(element)) {
          resized.unobserve(element);
          watched.delete(element);
        }
      }
      for (const element of elements) {
        if (!watched.has(element)) {
          watched.add(element);
          resized.observe(element);
        }
      }
      const next = elements.map((element): ScreenRect => {
        const box = element.getBoundingClientRect();
        return [
          Math.round(box.left - origin.left),
          Math.round(box.top - origin.top),
          Math.round(box.width),
          Math.round(box.height),
        ];
      });
      setBlocks((before) => (sameRects(before, next) ? before : next));
    };
    const resized = new ResizeObserver(measure);
    resized.observe(host);
    measure();
    const changed = new MutationObserver(measure);
    changed.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [frame, selector]);
  return blocks;
}

type Extra = { width: number; height: number };

const noExtra: Extra = { width: 0, height: 0 };

const extraStep = 8;

function useDrawnExtra(drawnAs: MinimapSize, slideRect: MapRect) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [extra, setExtra] = useState<Extra>(noExtra);
  const expected = useRef({ drawnAs, slideRect });
  expected.current = { drawnAs, slideRect };
  useEffect(() => {
    if (element === null) return;
    const measure = () => {
      const planned = minimapBox(expected.current.drawnAs, expected.current.slideRect);
      const step = (overflow: number) => Math.max(0, Math.ceil(overflow / extraStep) * extraStep);
      const width = step(element.offsetWidth - planned.width);
      const height = step(element.offsetHeight - planned.height);
      setExtra((before) =>
        width <= before.width && height <= before.height
          ? before
          : { width: Math.max(width, before.width), height: Math.max(height, before.height) },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [extra, setElement] as const;
}

function outerBox(wanted: MinimapSize, slideRect: MapRect, extra: Extra) {
  const box = minimapBox(wanted, slideRect);
  return { ...box, width: box.width + extra.width, height: box.height + extra.height };
}

export type MinimapReview = { taskId: string; current: string | null };

type ReviewProgress = {
  current: string;
  total: number;
  decided: number;
  slideName: string;
};

function useReviewProgress(
  review: MinimapReview | undefined,
  slideId: string,
): ReviewProgress | null {
  const enabled = review !== undefined;
  const taskId = review?.taskId ?? "";
  const objects = okData(useListReviewObjects(taskId, slideId, { query: { enabled } }).data);
  const decisions = okData(
    useListDecisions(taskId, slideId, undefined, { query: { enabled } }).data,
  );
  if (review === undefined || objects === undefined || objects.objects.length === 0) return null;
  const order = objects.objects.map((item) => item.object);
  const known = new Set(order);
  const slide = objects.slide;
  return {
    current: review.current ?? order[0] ?? "",
    total: order.length,
    decided: (decisions ?? []).filter((item) => known.has(item.object)).length,
    slideName: slide ? `${slide.label} · ${slide.stain}` : "",
  };
}

type StageMinimapProps = {
  engine: ViewerEngine;
  slideId: string;
  review?: MinimapReview;
  guided?: boolean;
  seenPercent?: number | null;
  overview?: StageSession["overview"];
  units?: Pick<ViewerModule, "effectiveMagnification">;
  surface?: MinimapSurface;
  onOpen?: (() => void) | undefined;
};

export function StageMinimap({
  slideId,
  overview,
  surface = "viewer",
  review,
  ...view
}: StageMinimapProps) {
  const image = useMinimapImage(slideId, overview);
  const setting = useResolvedSettings()?.minimap ?? "useful";
  const [choice, setChoice] = useMinimapCorner(surface);
  const progress = useReviewProgress(review, slideId);
  return (
    <PlacedMinimap
      {...view}
      image={image}
      progress={progress}
      setting={setting}
      choice={choice}
      onChoice={setChoice}
    />
  );
}

const PlacedMinimap = memo(function PlacedMinimap({
  engine,
  units,
  onOpen,
  guided = false,
  seenPercent = null,
  progress,
  image,
  setting,
  choice,
  onChoice: setChoice,
}: Pick<StageMinimapProps, "engine" | "units" | "onOpen" | "guided" | "seenPercent"> & {
  progress: ReviewProgress | null;
  image: ReturnType<typeof useMinimapImage>;
  setting: MinimapSetting;
  choice: CornerChoice;
  onChoice: (choice: CornerChoiceUpdate) => void;
}) {
  const { t } = useLingui();
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  useEffect(() => {
    const node = frame.current;
    if (node === null) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const slide = engine.getSlide();
  const viewport = viewportRect(camera, size);
  const magnification =
    units?.effectiveMagnification(camera.zoom, slide?.micronsPerPixel ?? null) ?? 2 ** camera.zoom;
  const moveView = useCallback(
    ([x, y]: [number, number]) => engine.setCamera({ ...engine.getCamera(), x, y }),
    [engine],
  );
  const slideRect: MapRect = [0, 0, slide?.width ?? 1, slide?.height ?? 1];
  const measured = slide !== null && size.width > 0;
  const tissueShare = measured ? tissueShareOnScreen(viewport, slideRect) : 1;
  const minimap = useMinimap(setting, { tissueShare, magnification });
  const { send } = minimap;
  useEffect(() => {
    send({ type: "CAMERA", tissueShare, magnification });
  }, [send, tissueShare, magnification]);
  const preferred: MinimapSize =
    guided || minimap.size === "pip" ? "compact" : (minimap.size ?? "full");
  const power = `${Math.round(magnification)}×`;
  const foot =
    guided && progress !== null
      ? progress.slideName
      : progress === null
        ? t`Whole slide`
        : t`${progress.current} of ${progress.total}`;
  const footEnd = guided
    ? undefined
    : progress === null
      ? power
      : t`${power} · ${progress.decided} of ${progress.total} decided`;
  const blocks = useStageBlocks(frame);
  const drawnAs = useRef<MinimapSize>(preferred);
  const [extra, drawn] = useDrawnExtra(drawnAs.current, slideRect);
  const wanted = placeMinimap(size, outerBox(preferred, slideRect, extra), [], blocks);
  const boxSize: MinimapSize = fitsCanvas(size, wanted) ? preferred : "pip";
  drawnAs.current = boxSize;
  const sized = outerBox(boxSize, slideRect, extra);
  const chosen = cornerOfChoice(choice);
  const scored = boxSize === preferred ? wanted : placeMinimap(size, sized, [], blocks);
  const place = useHeldCorner(chosenPlacement(scored, chosen), camera);
  const [dragging, setDragging] = useState(false);
  const shown = measured && minimap.size !== null && fitsCanvas(size, scored);
  useMainPopoutSync({
    viewport,
    magnification,
    ...(slide === null ? {} : { extent: [slide.width, slide.height] }),
    onMoveTo: moveView,
  });
  return (
    <div ref={frame} className="pointer-events-none absolute inset-0">
      {dragging
        ? landingCorners.map((corner) => {
            const landing = pinnedMinimap(size, sized, corner);
            return (
              <span
                key={corner}
                aria-hidden="true"
                data-landing={corner}
                className="absolute z-2 rounded-zone border border-dashed border-white/50 bg-white/5"
                style={{
                  left: landing.x,
                  top: landing.y,
                  width: sized.width,
                  height: sized.height,
                }}
              />
            );
          })
        : null}
      {slide === null || image === null || !shown ? null : (
        <SmartMinimap
          ref={drawn}
          data-testid="stage-minimap"
          data-source={image.source}
          data-corner={place.corner}
          data-placed={chosen === null ? "auto" : "pinned"}
          data-mode={minimap.mode}
          className="pointer-events-auto"
          size={boxSize}
          image={{ src: image.src ?? "", width: slide.width, height: slide.height }}
          title={
            <>
              <b>{t`Whole slide`}</b>
              {seenPercent === null ? null : t` · ${seenPercent}% seen`}
            </>
          }
          foot={foot}
          footEnd={footEnd}
          viewport={viewport}
          onOpen={onOpen}
          onMoveView={moveView}
          onPopOut={() => void openPopout("minimap")}
          move={{
            pinned: chosen !== null,
            onDragChange: setDragging,
            onDrop: (centre) => {
              const bounds = frame.current?.getBoundingClientRect();
              if (!bounds) return;
              setChoice(
                choiceOfCorner(
                  cornerOfPoint(size, [centre[0] - bounds.left, centre[1] - bounds.top]),
                ),
              );
            },
            onStep: (key) =>
              setChoice((current) =>
                choiceOfCorner(stepCorner(cornerOfChoice(current) ?? place.corner, key)),
              ),
            onAuto: () => setChoice("auto"),
          }}
          style={{ left: place.x, top: place.y }}
        >
          <MapViewport rect={viewport} />
        </SmartMinimap>
      )}
    </div>
  );
});
