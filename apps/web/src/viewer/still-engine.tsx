import { useEffect, useMemo, useRef, useState } from "react";
import { loadViewerEngine } from "./load-engine.ts";
import { engineCameraOf, engineRing, type StillCamera } from "./still-frame.ts";
import { runStillEngine, type StillLink, type StillOpened } from "./still-lifecycle.ts";
import { grantFor } from "./tile-grant.ts";

export type { StillLink };

export type StillObject = {
  readonly id: string;
  readonly ring: ArrayLike<number>;
  readonly inSlide: boolean;
  readonly className: string;
  readonly score: number;
  readonly decision?: "agree" | "disagree" | "unsure" | null | undefined;
};

export type StillDrawChoices = {
  readonly draw: string;
  readonly width: string;
  readonly opacity: number;
  readonly colorBy: string;
  readonly cutoff: number;
  readonly confidence: string;
};

type Live = StillOpened;

const classNames = ["tumor", "stroma", "immune", "other"] as const;

type EngineClass = (typeof classNames)[number];

const classOf = (name: string): EngineClass =>
  classNames.find((item) => item === name.toLowerCase()) ?? "other";

export function StillEngine({
  slideId,
  camera,
  objects,
  choices,
  hiddenClasses,
  onReady,
  onTiles,
}: {
  slideId: string;
  camera: StillCamera;
  objects: readonly StillObject[] | null;
  choices: StillDrawChoices;
  hiddenClasses: ReadonlySet<string>;
  onReady: (link: StillLink | null) => void;
  onTiles: (failed: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const { x: cameraX, y: cameraY, scale: cameraScale } = camera;
  const report = useRef(onReady);
  report.current = onReady;
  const tiles = useRef(onTiles);
  tiles.current = onTiles;
  const [live, setLive] = useState<Live | null>(null);
  const [ready, setReady] = useState(false);
  const [engineCamera, setEngineCamera] = useState("");
  const [drawn, setDrawn] = useState({
    overlays: 0,
    below: 0,
    hidden: 0,
    scope: 0,
    styles: "[]",
    colours: "{}",
  });

  useEffect(() => {
    const container = host.current;
    if (container === null) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    const down = () => {
      setLive(null);
      setReady(false);
      report.current(null);
      tiles.current(0);
    };
    void loadViewerEngine().then(
      (module) => {
        if (cancelled) return;
        stop = runStillEngine({
          module,
          container,
          slideId,
          grant: (previous) => grantFor(slideId, previous),
          onOpened: setLive,
          onLink: (link) => {
            setReady(true);
            report.current(link);
          },
          onTiles: (failed) => tiles.current(failed),
          onFail: down,
        });
      },
      () => {
        if (!cancelled) down();
      },
    );
    return () => {
      cancelled = true;
      stop?.();
      down();
    };
  }, [slideId]);

  useEffect(() => {
    if (live === null) return;
    live.engine.setCamera(
      engineCameraOf({ x: cameraX, y: cameraY, scale: cameraScale }, live.frame),
    );
    live.checkTiles();
    const now = live.engine.getCamera();
    setEngineCamera(`${now.x.toFixed(2)},${now.y.toFixed(2)},${now.zoom.toFixed(4)}`);
  }, [live, cameraX, cameraY, cameraScale]);

  const placed = useMemo(
    () =>
      live === null || objects === null
        ? []
        : objects.map((object) => ({
            id: object.id,
            kind: "region" as const,
            ring: object.inSlide
              ? Float32Array.from(object.ring)
              : engineRing(object.ring, live.frame),
            className: classOf(object.className),
            score: object.score,
            decision: object.decision ?? null,
          })),
    [live, objects],
  );
  const hidden = useMemo(
    () =>
      new Set<EngineClass>(
        [...hiddenClasses].flatMap((name) => {
          const found = classNames.find((item) => item === name.toLowerCase());
          return found === undefined ? [] : [found];
        }),
      ),
    [hiddenClasses],
  );
  const { draw, width, opacity, colorBy, cutoff, confidence } = choices;
  const stable = useMemo(
    () => ({ draw, width, opacity, colorBy, cutoff, confidence }),
    [draw, width, opacity, colorBy, cutoff, confidence],
  );

  useEffect(() => {
    if (live === null) return;
    const { drawing, module } = live;
    drawing.setObjects(placed);
    drawing.setHiddenClasses(hidden);
    drawing.setChoices(stable);
    const result = drawing.result();
    const colourBy = drawing.settings().colourBy;
    setDrawn({
      overlays: result?.overlays.length ?? 0,
      below: result?.belowCutoff.length ?? 0,
      hidden: result?.hiddenByClass.length ?? 0,
      scope: result?.scope.length ?? 0,
      styles: JSON.stringify(
        (result?.overlays ?? []).map((overlay) => ({
          part: overlay.id.slice(overlay.id.lastIndexOf(":") + 1),
          width: overlay.style.lineWidthPx,
          fill: overlay.style.fillOpacity,
          dashed: overlay.style.dash !== null,
          opacity: overlay.opacity,
        })),
      ),
      colours: JSON.stringify(
        Object.fromEntries(
          placed.map((object) => [object.id, module.objectColour(object, colourBy)]),
        ),
      ),
    });
  }, [live, placed, hidden, stable]);

  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        ref={host}
        data-testid="still-engine"
        data-state={ready ? "ready" : live === null ? "loading" : "opening"}
        data-objects={placed.length}
        data-overlays={drawn.overlays}
        data-below-cutoff={drawn.below}
        data-hidden={drawn.hidden}
        data-scope={drawn.scope}
        data-styles={drawn.styles}
        data-colours={drawn.colours}
        data-draw={choices.draw}
        data-width={choices.width}
        data-color-by={choices.colorBy}
        data-camera={engineCamera}
        data-frame={
          live === null ? "" : `${live.frame.scale},${live.frame.offsetX},${live.frame.offsetY}`
        }
        className="absolute inset-0"
      />
    </div>
  );
}
