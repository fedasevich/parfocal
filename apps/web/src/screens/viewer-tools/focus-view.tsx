import { Keycap } from "@parfocal/ui/components/keycap";
import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import {
  MapTrail,
  MapViewport,
  minimapBox,
  SmartMinimap,
} from "@parfocal/ui/components/smart-minimap";
import { StatusTag } from "@parfocal/ui/components/tag";
import { FloatingPill, FocusCard } from "@parfocal/ui/components/viewer-tools";
import { useEffect, useState } from "react";
import { useAnswerKeys } from "../review/answer-keys.ts";
import { answersOf, countsAs, countWord } from "../review/decision-style.ts";
import { type Camera, midSize, SlideStill } from "../review/slide-still.tsx";
import { useDecisionSaves } from "../review/use-decision-saves.ts";
import { lookUrl } from "../thumbnails.ts";
import { type HotSpot, pathPoints, placeMinimap, type ScreenRect } from "./minimap-placement.ts";
import { hotWeight } from "./minimap-weights.ts";
import { MinimapAreas, toScreen, viewportOf } from "./slide-maps.tsx";
import { SlidePeek, usePeekKey } from "./slide-peek.tsx";
import { midEdge, seenPercent, seenTrail } from "./tool-geometry.ts";
import { coverHome } from "./tool-maths.ts";
import type { ToolSession } from "./tool-session.tsx";

const edgePoints = pathPoints(midEdge);

const overviewImage = { src: lookUrl("overview"), width: 1400, height: 1924 };

const tone = { agree: "ok", disagree: "bad", unsure: "warn" } as const;

export function FocusView({
  tools,
  object,
  onShowUi,
  peekOpen,
  onPeekChange,
}: {
  tools: ToolSession;
  object: string | undefined;
  onShowUi: () => void;
  peekOpen: boolean;
  onPeekChange: (open: boolean) => void;
}) {
  const [held, setHeld] = useState(false);
  usePeekKey(
    peekOpen,
    (next) => {
      setHeld(next);
      if (!peekOpen) onPeekChange(true);
    },
    () => {
      setHeld(false);
      onPeekChange(false);
    },
  );
  const { session, answer, setAnswer } = tools;
  const decisions = useDecisionSaves(session, session.style);
  const [camera, setCamera] = useState<Camera | null>(null);
  const regions = session.objects.filter((item) => item.kind === "region");
  const current =
    regions.find((item) => item.object === object) ??
    regions.find((item) => item.object === "T5") ??
    regions[0];
  const decided = current ? answer(current.object) : undefined;
  const keys = current ? answersOf(session.style, session.classes, current) : [];
  const decide = (raw: string) => {
    if (current === undefined) return;
    const value = countsAs(session.style, raw, current);
    setAnswer(current.object, { value, raw, reasons: [], note: null });
    decisions.save(current.object, raw, value);
  };

  useAnswerKeys(keys, decide, current !== undefined);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        onShowUi();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const slideLabel = session.slideName.split(" ")[0] ?? "";
  const areas = regions.map((region) => ({ object: region.object, size: region.size_mm ?? 0 }));
  return (
    <main className="relative flex h-dvh bg-[#262626] text-fg" data-testid="focus-mode">
      <SlideStill
        view={{ kind: "whole" }}
        look="mid"
        homeOf={coverHome(midSize, [700, 520])}
        camera={camera}
        onCameraChange={setCamera}
        regionDecisions={{}}
        bare
        minimap={false}
        hint={false}
        underlay={() => (
          <path
            d={midEdge}
            fill="none"
            stroke="#fff"
            strokeWidth={2.5}
            strokeDasharray="10 7"
            strokeOpacity={0.85}
            vectorEffect="non-scaling-stroke"
          />
        )}
        overlay={({ camera: shown, size }) => {
          const card: ScreenRect = [size.width - 330, size.height - 170, 316, 156];
          const hot: HotSpot[] = edgePoints.map((point) => {
            const at = toScreen(shown, size, point);
            return [at.x, at.y, hotWeight.tumorEdge];
          });
          const box = minimapBox("full", [0, 0, overviewImage.width, overviewImage.height]);
          const place = placeMinimap(size, box, hot, [
            [size.width / 2 - 250, size.height - 58, 500, 50],
            card,
            [size.width / 2 - 170, 0, 340, 50],
          ]);
          return (
            <>
              <FloatingPill>
                <b>{session.caseLabel ?? slideLabel}</b>
                <span className="text-fg-faint">
                  {slideLabel} · {current?.object} · 10×
                </span>
                <button
                  type="button"
                  onClick={onShowUi}
                  aria-label="Show the interface"
                  className="cursor-pointer border-0 bg-transparent p-0"
                >
                  <Keycap action="hideui" keys="⌘\" size="sm" />
                </button>
              </FloatingPill>
              {current ? (
                <FocusCard
                  className="right-3.5 bottom-3.5"
                  title={`${current.object} · Tumor region`}
                  status={
                    <StatusTag tone={decided ? tone[decided.value] : "neutral"}>
                      {decided ? countWord[decided.value].toLowerCase() : "open"}
                    </StatusTag>
                  }
                  text={`${current.size_mm?.toFixed(2) ?? ""} mm across. ${decided ? "Decided. Press a key again to change it." : "Still open."}`}
                  keys={[
                    ...keys.map((item) => ({
                      key: item.key,
                      label: item.label.toLowerCase(),
                      onPress: () => decide(item.raw),
                    })),
                    { key: "⌘\\", label: "show UI", onPress: onShowUi },
                  ]}
                />
              ) : null}
              <SmartMinimap
                data-corner={place.corner}
                image={overviewImage}
                title={
                  <>
                    <b>Whole slide</b> · {seenPercent.reading}% seen
                  </>
                }
                foot={`T2 of ${areas.length}`}
                footEnd={`10× · ${regions.filter((region) => answer(region.object)).length} of ${areas.length} decided`}
                onOpen={() => onPeekChange(true)}
                style={{ left: place.x, top: place.y }}
              >
                <MapTrail rects={seenTrail} />
                <MinimapAreas areas={areas} checked={["T1"]} current="T2" />
                <MapViewport rect={viewportOf("mid", shown, size)} />
              </SmartMinimap>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                <MagnificationBar
                  magnification={9}
                  scaleLabel="100 µm"
                  scalePx={92}
                  micronsPerPixel={1.13}
                />
              </div>
            </>
          );
        }}
      />
      {peekOpen ? (
        <SlidePeek
          slideName={session.slideName}
          areas={areas}
          checked={regions.filter((region) => answer(region.object)).map((region) => region.object)}
          atCell={false}
          held={held}
          onClose={() => onPeekChange(false)}
          onPick={() => onPeekChange(false)}
        />
      ) : null}
    </main>
  );
}
