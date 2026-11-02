import { createSlideAccess, signedOpenRequest, type TileGrant } from "@parfocal/viewer-engine";
import { mountSlideViewport, type SlideViewport } from "@parfocal/viewer-engine/viv";
import {
  type SignedHarness,
  type SignedOpenResult,
  signedHarnessGlobal,
} from "./signed-protocol.ts";

interface TileAccessBody {
  readonly token: string;
  readonly lifetime_seconds: number;
  readonly base_path: string;
  readonly original: string;
}

async function loadGrant(slideId: string, previous: string | null): Promise<TileGrant> {
  const response = await fetch(`/api/slides/${slideId}/tile-access`, {
    headers: previous === null ? {} : { "Previous-Tile-Token": previous },
  });
  if (!response.ok) throw new Error(`tile-access answered ${response.status}`);
  const body = (await response.json()) as TileAccessBody;
  return {
    token: body.token,
    lifetimeSeconds: body.lifetime_seconds,
    basePath: body.base_path,
    original: body.original,
  };
}

function container(): HTMLElement {
  const element = document.getElementById("viewer");
  if (element === null) throw new Error("The harness page has no #viewer element");
  return element;
}

const errors: string[] = [];
let viewport: SlideViewport | null = null;

globalThis.addEventListener("error", (event) => {
  errors.push(String(event.message));
});
globalThis.addEventListener("unhandledrejection", (event) => {
  errors.push(String(event.reason));
});

function current(): SlideViewport {
  if (viewport === null) throw new Error("No slide is open");
  return viewport;
}

const settle = async (): Promise<void> => {
  await current().route()?.whenIdle();
};

const dispose = (): void => {
  viewport?.dispose();
  viewport = null;
  errors.length = 0;
};

const open = async (slideId: string): Promise<SignedOpenResult> => {
  dispose();
  const access = createSlideAccess((previous) => loadGrant(slideId, previous));
  viewport = mountSlideViewport({
    container: container(),
    slideId,
    route: {
      onError: (error) => {
        errors.push(error.message);
      },
    },
    resolve: async () => {
      const grant = await access.grant();
      return signedOpenRequest({
        access: access.access,
        basePath: grant.basePath,
        original: grant.original,
      });
    },
  });
  const slide = await viewport.ready;
  await settle();
  return {
    camera: viewport.engine.getCamera(),
    slide: { width: slide.width, height: slide.height, micronsPerPixel: slide.micronsPerPixel },
    errors: [...errors],
  };
};

const harness: SignedHarness = {
  open,
  settle,
  camera: () => current().engine.getCamera(),
  dispose,
};
Object.assign(globalThis, { [signedHarnessGlobal]: harness });
