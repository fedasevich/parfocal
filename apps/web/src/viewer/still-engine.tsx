import { useEffect, useMemo, useRef, useState } from "react";
import { loadViewerEngine } from "./load-engine.ts";
import type { ViewerModule } from "./magnification-control.tsx";
import { engineCameraOf, engineRing, overviewFrame, type StillFrame } from "./still-frame.ts";
import { grantFor } from "./tile-grant.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export type StillObject = {
  readonly id: string;
  readonly ring: ArrayLike<number>;
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

type Live = {
  readonly engine: ViewerEngine;
  readonly module: ViewerModule;
  readonly frame: StillFrame;
};

const classNames = ["tumor", "stroma", "immune", "other"] as const;

type EngineClass = (typeof classNames)[number];

const classOf = (name: string): EngineClass =>
  classNames.find((item) => item === name.toLowerCase()) ?? "other";

const drawingId = "still-objects";

export function StillEngine({
  slideId,
  camera,
  objects,
  choices,
  hiddenClasses,
  onReady,
}: {
  slideId: string;
  camera: { x: number; y: number; scale: number };
  objects: readonly StillObject[] | null;
  choices: StillDrawChoices;
  hiddenClasses: ReadonlySet<string>;
  onReady: (up: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const { x: cameraX, y: cameraY, scale: cameraScale } = camera;
  const report = useRef(onReady);
  report.current = onReady;
  const [live, setLive] = useState<Live | null>(null);
  const [ready, setReady] = useState(false);
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
    let disposed = false;
    let dispose: (() => void) | null = null;
    const fail = () => {
      if (disposed) return;
      setLive(null);
      setReady(false);
      report.current(false);
    };
    void loadViewerEngine().then((module) => {
      if (disposed) return;
      const access = module.createSlideAccess((previous) => grantFor(slideId, previous));
      const viewport = module.mountSlideViewport({
        container,
        slideId,
        route: { onError: fail, onTileError: () => {} },
        resolve: async () => {
          const grant = await access.grant();
          return module.signedOpenRequest({
            access: access.access,
            basePath: grant.basePath,
            original: grant.original,
            identifiedFormat: grant.format ?? null,
          });
        },
      });
      dispose = () => viewport.dispose();
      viewport.ready
        .then((slide) => {
          if (disposed) return;
          setLive({ engine: viewport.engine, module, frame: overviewFrame(slide) });
          return viewport.route()?.whenIdle();
        })
        .then(() => {
          if (disposed) return;
          setReady(true);
          report.current(true);
        })
        .catch(fail);
    }, fail);
    return () => {
      disposed = true;
      setLive(null);
      setReady(false);
      report.current(false);
      dispose?.();
    };
  }, [slideId]);

  useEffect(() => {
    if (live === null) return;
    live.engine.setCamera(
      engineCameraOf({ x: cameraX, y: cameraY, scale: cameraScale }, live.frame),
    );
  }, [live, cameraX, cameraY, cameraScale]);

  const drawing = useMemo(
    () =>
      live === null ? null : live.module.createObjectDrawing({ id: drawingId, host: live.engine }),
    [live],
  );
  useEffect(() => () => drawing?.clear(), [drawing]);

  const placed = useMemo(
    () =>
      live === null || objects === null
        ? []
        : objects.map((object) => ({
            id: object.id,
            kind: "region" as const,
            ring: engineRing(object.ring, live.frame),
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
    if (drawing === null) return;
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
          placed.map((object) => [
            object.id,
            live === null ? [] : live.module.objectColour(object, colourBy),
          ]),
        ),
      ),
    });
  }, [drawing, live, placed, hidden, stable]);

  return (
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
      className="pointer-events-none absolute inset-0"
    />
  );
}
