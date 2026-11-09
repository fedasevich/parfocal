import type { ViewerModule } from "./magnification-control.tsx";
import {
  engineCameraOf,
  overviewFrame,
  type StillCamera,
  type StillFrame,
  stillCameraOf,
} from "./still-frame.ts";
import type { Grant } from "./tile-grant.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export type StillLink = {
  readonly frame: StillFrame;
  readonly clamp: (camera: StillCamera) => StillCamera;
};

export type StillModule = Pick<
  ViewerModule,
  | "createSlideAccess"
  | "mountSlideViewport"
  | "signedOpenRequest"
  | "createObjectDrawing"
  | "clampCamera"
  | "objectColour"
>;

export type ObjectDrawing = ReturnType<ViewerModule["createObjectDrawing"]>;

export type StillOpened = {
  readonly engine: ViewerEngine;
  readonly module: StillModule;
  readonly frame: StillFrame;
  readonly drawing: ObjectDrawing;
  readonly checkTiles: () => void;
};

const drawingId = "still-objects";

const sameCamera = (a: StillCamera, b: StillCamera) =>
  Math.abs(a.x - b.x) < 1e-6 &&
  Math.abs(a.y - b.y) < 1e-6 &&
  Math.abs(a.scale / b.scale - 1) < 1e-9;

function linkOf(module: StillModule, engine: ViewerEngine, frame: StillFrame): StillLink {
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

export function runStillEngine({
  module,
  container,
  slideId,
  grant,
  onOpened,
  onLink,
  onTiles,
  onFail,
}: {
  module: StillModule;
  container: HTMLElement;
  slideId: string;
  grant: (previous: string | null) => Promise<Grant>;
  onOpened: (opened: StillOpened) => void;
  onLink: (link: StillLink) => void;
  onTiles: (failed: number) => void;
  onFail: () => void;
}): () => void {
  let stopped = false;
  let checking = false;
  let drawing: ObjectDrawing | null = null;
  const access = module.createSlideAccess(grant);
  const fail = () => {
    if (stopped) return;
    stopped = true;
    queueMicrotask(release);
    onFail();
  };
  const checkTiles = () => {
    const route = viewport.route();
    if (stopped || checking || route === null) return;
    checking = true;
    void route.whenIdle().then(() => {
      checking = false;
      if (!stopped) onTiles(route.failedTiles().length);
    });
  };
  const viewport = module.mountSlideViewport({
    container,
    slideId,
    route: { onError: fail, onTileError: () => checkTiles() },
    resolve: async () => {
      const granted = await access.grant();
      return module.signedOpenRequest({
        access: access.access,
        basePath: granted.basePath,
        original: granted.original,
        identifiedFormat: granted.format ?? null,
      });
    },
  });
  let released = false;
  function release() {
    if (released) return;
    released = true;
    drawing?.clear();
    drawing = null;
    viewport.dispose();
  }
  let link: StillLink | null = null;
  viewport.ready
    .then((slide) => {
      if (stopped) return;
      const frame = overviewFrame(slide);
      drawing = module.createObjectDrawing({ id: drawingId, host: viewport.engine });
      link = linkOf(module, viewport.engine, frame);
      onOpened({ engine: viewport.engine, module, frame, drawing, checkTiles });
      return viewport.route()?.whenIdle();
    })
    .then(() => {
      if (stopped || link === null) return;
      onLink(link);
      checkTiles();
    })
    .catch(fail);
  return () => {
    stopped = true;
    release();
  };
}
