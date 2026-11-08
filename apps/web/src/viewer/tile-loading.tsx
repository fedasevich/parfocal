import { Button } from "@parfocal/ui/components/button";
import { TileHint as TileHintCard } from "@parfocal/ui/components/visualize";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStageRect } from "../annotations/stage-size.ts";
import { destinations } from "../shell/destinations.ts";
import { clipToStage, hintCopy, type TileHint, tileHintOf } from "./tile-hint.ts";
import { slideToScreen, type ViewerEngine, type VivRoute } from "./viewer-engine.ts";

const pollMs = 200;

type Shown = { readonly hint: TileHint | null; readonly percent: number };

const hintCopyOf = (hint: TileHint | null) => (hint === null ? "" : hintCopy(hint));

const openingPercent = 6;

function useTileHint(route: VivRoute | null): Shown {
  const [shown, setShown] = useState<Shown>({ hint: null, percent: 0 });
  const peak = useRef(0);
  const mountedAt = useRef(performance.now());
  useEffect(() => {
    const read = () => {
      if (route === null) {
        const waited = performance.now() - mountedAt.current;
        const hint = tileHintOf({ pending: 0, waitingMs: waited, answerMs: waited }, true);
        setShown((old) =>
          hintCopyOf(old.hint) === hintCopyOf(hint) ? old : { hint, percent: openingPercent },
        );
        return;
      }
      const state = route.loadState();
      peak.current = state.pending === 0 ? 0 : Math.max(peak.current, state.pending);
      const hint = tileHintOf(state);
      const percent = peak.current === 0 ? 0 : Math.round((1 - state.pending / peak.current) * 100);
      setShown((old) =>
        hintCopyOf(old.hint) === hintCopyOf(hint) && old.percent === percent
          ? old
          : { hint, percent },
      );
    };
    read();
    const timer = window.setInterval(read, pollMs);
    return () => window.clearInterval(timer);
  }, [route]);
  return shown;
}

export function TileHintChip({ route }: { route: VivRoute | null }) {
  const router = useRouter();
  const { hint, percent } = useTileHint(route);
  if (hint === null) return null;
  return (
    <TileHintCard
      data-testid="tile-hint"
      data-kind={hint.kind}
      percent={hint.kind === "slow" ? 70 : percent}
      className={`absolute bottom-[4.5rem] left-1/2 -translate-x-1/2${hint.kind === "slow" ? " w-112" : ""}`}
      action={
        hint.kind === "slow" ? (
          <Button
            size="sm"
            onClick={() =>
              void router.navigate({ href: `${destinations.admin()}?section=storage` })
            }
          >
            Source status
          </Button>
        ) : undefined
      }
    >
      {hintCopy(hint)}
    </TileHintCard>
  );
}

const checkerCell = 16;

export function SlideChecker({ engine, stage }: { engine: ViewerEngine; stage: HTMLElement }) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const slide = engine.getSlide();
  const rect = useStageRect(stage);
  if (slide === null) return null;
  const from = slideToScreen(camera, rect, { x: 0, y: 0 });
  const to = slideToScreen(camera, rect, { x: slide.width, y: slide.height });
  const box = clipToStage(
    { left: from.x, top: from.y, width: to.x - from.x, height: to.y - from.y },
    rect,
  );
  return (
    <div
      aria-hidden="true"
      data-testid="slide-checker"
      className="pointer-events-none absolute"
      style={{
        ...box,
        backgroundColor: "var(--color-chrome)",
        backgroundImage:
          "conic-gradient(var(--color-line) 25%, transparent 25% 50%, var(--color-line) 50% 75%, transparent 75%)",
        backgroundSize: `${checkerCell * 2}px ${checkerCell * 2}px`,
        opacity: 0.5,
      }}
    />
  );
}
