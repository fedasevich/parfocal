import { useEffect, useMemo, useRef, useState } from "react";
import { loadViewerEngine } from "./load-engine.ts";
import type { ViewerModule } from "./magnification-control.tsx";
import {
  engineCameraOf,
  engineRing,
  overviewFrame,
  type StillCamera,
  type StillFrame,
  stillCameraOf,
} from "./still-frame.ts";
import { grantFor } from "./tile-grant.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

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

export type StillLink = {
  readonly frame: StillFrame;
  readonly clamp: (camera: StillCamera) => StillCamera;
};

type ObjectDrawing = ReturnType<ViewerModule["createObjectDrawing"]>;

type Live = {
  readonly engine: ViewerEngine;
  readonly module: ViewerModule;
  readonly frame: StillFrame;
  readonly drawing: ObjectDrawing;
};

const classNames = ["tumor", "stroma", "immune", "other"] as const;

type EngineClass = (typeof classNames)[number];

const classOf = (name: string): EngineClass =>
  classNames.find((item) => item === name.toLowerCase()) ?? "other";

const drawingId = "still-objects";

const sameCamera = (a: StillCamera, b: StillCamera) =>
  Math.abs(a.x - b.x) < 1e-6 &&
  Math.abs(a.y - b.y) < 1e-6 &&
  Math.abs(a.scale / b.scale - 1) < 1e-9;

function linkOf(module: ViewerModule, engine: ViewerEngine, frame: StillFrame): StillLink {
  return {
    frame,
    clamp: (camera) => {
      const asked = engineCameraOf(camera, frame);
      const kept = module.clampCamera(asked, {
        ...engine.getCameraBounds(),
        maxZoom: Number.POSITIVE_INFINITY,
      });
      if (kept === asked) return camera;
      const back = stillCameraOf(kept, frame);
      return sameCamera(back, camera) ? camera : back;
    },
  };
}

export function StillEngine({
  slideId,
  camera,
  objects,
  choices,
  hiddenClasses,
  onReady,
}: {
  slideId: string;
  camera: StillCamera;
  objects: readonly StillObject[] | null;
  choices: StillDrawChoices;
  hiddenClasses: ReadonlySet<string>;
  onReady: (link: StillLink | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const { x: cameraX, y: cameraY, scale: cameraScale } = camera;
  const report = useRef(onReady);
  report.current = onReady;
  const [live, setLive] = useState<Live | null>(null);
  const [ready, setReady] = useState(false);
  const [tileFailures, setTileFailures] = useState(0);
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
    let disposed = false;
    let dispose: (() => void) | null = null;
    setTileFailures(0);
    const fail = () => {
      if (disposed) return;
      setLive(null);
      setReady(false);
      report.current(null);
    };
    void loadViewerEngine().then((module) => {
      if (disposed) return;
      const access = module.createSlideAccess((previous) => grantFor(slideId, previous));
      const viewport = module.mountSlideViewport({
        container,
        slideId,
        route: {
          onError: fail,
          onTileError: () => {
            if (!disposed) setTileFailures((count) => count + 1);
          },
        },
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
      let drawing: ObjectDrawing | null = null;
      dispose = () => {
        drawing?.clear();
        drawing = null;
        viewport.dispose();
      };
      let link: StillLink | null = null;
      viewport.ready
        .then((slide) => {
          if (disposed) return;
          const frame = overviewFrame(slide);
          drawing = module.createObjectDrawing({ id: drawingId, host: viewport.engine });
          link = linkOf(module, viewport.engine, frame);
          setLive({ engine: viewport.engine, module, frame, drawing });
          return viewport.route()?.whenIdle();
        })
        .then(() => {
          if (disposed || link === null) return;
          setReady(true);
          report.current(link);
        })
        .catch(fail);
    }, fail);
    return () => {
      disposed = true;
      setLive(null);
      setReady(false);
      report.current(null);
      dispose?.();
    };
  }, [slideId]);

  useEffect(() => {
    if (live === null) return;
    live.engine.setCamera(
      engineCameraOf({ x: cameraX, y: cameraY, scale: cameraScale }, live.frame),
    );
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
        data-tile-failures={tileFailures}
        className="absolute inset-0"
      />
      {tileFailures > 0 ? (
        <span
          role="status"
          data-testid="still-tile-failures"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-body-sm font-medium text-white"
        >
          Some tiles did not load. Parts of the slide may look blank.
        </span>
      ) : null}
    </div>
  );
}
