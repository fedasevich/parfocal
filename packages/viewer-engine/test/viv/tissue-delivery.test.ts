import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { syntheticDir } from "@parfocal/test-fixtures";
import {
  type Camera,
  createViewerEngine,
  type EngineSlide,
  fitCamera,
  openTiffSource,
  type SlideArea,
} from "../../src/index.ts";
import {
  createPixelSlideOpener,
  fetchTissueBox,
  type PixelSlideRequest,
  readTissueBox,
} from "../../src/viv/index.ts";
import { FakeContainer, FakeFrames, FakeRenderer, FakeResize } from "../engine-fakes.ts";
import { serve } from "../pixel-source/serve.ts";

const sidecars = await mkdtemp(join(tmpdir(), "tissue-sidecar-"));
const file = "synthetic-zlib.ome.tiff";
const served = await serve({ "/synthetic": syntheticDir, "/sidecar": sidecars });

after(async () => {
  await Promise.all([served.close(), rm(sidecars, { recursive: true, force: true })]);
});

const limits = { minZoom: -10, maxZoom: 2 };

const extent = await (async () => {
  const source = await openTiffSource({
    formatId: "ome-tiff",
    url: served.url(`/synthetic/${file}`),
  });
  try {
    const [base] = source.levels;
    assert.ok(base);
    return { width: base.width, height: base.height };
  } finally {
    source.close();
  }
})();

const box: SlideArea = {
  x: Math.round(extent.width * 0.25),
  y: Math.round(extent.height * 0.25),
  width: Math.round(extent.width * 0.5),
  height: Math.round(extent.height * 0.5),
};

async function store(name: string, document: unknown): Promise<void> {
  await writeFile(join(sidecars, name), JSON.stringify(document));
}

await store("with-box.json", { cell: 64, threshold: 20, fraction: 0.4, box });
await store("without-box.json", { cell: 64, threshold: 20, fraction: 0, box: null });
await store("old-slide.json", { cell: 64, threshold: 20, fraction: 0.4 });
await writeFile(join(sidecars, "broken.json"), "{not json");

function openWith(extra: Partial<PixelSlideRequest>) {
  const container = new FakeContainer();
  const engine = createViewerEngine<EngineSlide>({
    createRenderer: new FakeRenderer().create,
    openSlide: createPixelSlideOpener(() => ({
      formatId: "ome-tiff",
      url: served.url(`/synthetic/${file}`),
      ...extra,
    })),
    zoomLimits: limits,
    frames: new FakeFrames(),
    observeResize: new FakeResize().observe,
    devicePixelRatio: () => 1,
  });
  engine.mount(container);
  return { engine, container };
}

function sidecar(name: string): Partial<PixelSlideRequest> {
  return { tissueUrl: served.url(`/sidecar/${name}`) };
}

function assertCamera(actual: Camera, expected: Camera): void {
  for (const key of ["x", "y", "zoom"] as const) {
    assert.ok(Math.abs(actual[key] - expected[key]) <= 1e-9, `${key}: ${actual[key]}`);
  }
}

describe("the tissue box that tissue.json stores", () => {
  it("reads the box that ingest writes", () => {
    assert.deepEqual(readTissueBox({ cell: 64, box }), box);
  });

  it("reads no box from a missing, null, empty or malformed one", () => {
    for (const document of [
      null,
      "text",
      {},
      { box: null },
      { box: { x: 0, y: 0, width: 0, height: 10 } },
      { box: { x: 0, y: 0, width: "10", height: 10 } },
      { box: { x: Number.NaN, y: 0, width: 10, height: 10 } },
    ]) {
      assert.equal(readTissueBox(document), null);
    }
  });

  it("fetches the stored box, and nothing when the file is missing or broken", async () => {
    const at = (name: string) => fetchTissueBox({ url: served.url(`/sidecar/${name}`) });
    assert.deepEqual(await at("with-box.json"), box);
    assert.equal(await at("without-box.json"), null);
    assert.equal(await at("old-slide.json"), null);
    assert.equal(await at("broken.json"), null);
    assert.equal(await at("absent.json"), null);
  });
});

describe("the real opener delivers the tissue box to the viewer", () => {
  it("opens fitted to the stored box", async () => {
    const { engine, container } = openWith(sidecar("with-box.json"));
    await engine.openSlide({ id: "stored" });
    const whole = fitCamera(extent, container.rect, limits, null);
    assertCamera(engine.getCamera(), fitCamera(extent, container.rect, limits, box));
    assert.ok(engine.getCamera().zoom > whole.zoom);
    engine.dispose();
  });

  it("opens fitted to the whole scan when the slide has no stored box", async () => {
    const whole = fitCamera(extent, new FakeContainer().rect, limits, null);
    const none: (Partial<PixelSlideRequest> | undefined)[] = [
      sidecar("without-box.json"),
      sidecar("old-slide.json"),
      sidecar("broken.json"),
      sidecar("absent.json"),
      {},
    ];
    for (const extra of none) {
      const { engine } = openWith(extra ?? {});
      await engine.openSlide({ id: "plain" });
      assertCamera(engine.getCamera(), whole);
      engine.dispose();
    }
  });

  it("prefers a box the caller already holds over the stored file", async () => {
    const held = { x: 0, y: 0, width: extent.width / 2, height: extent.height / 2 };
    const { engine, container } = openWith({ tissue: held, ...sidecar("with-box.json") });
    await engine.openSlide({ id: "held" });
    assertCamera(engine.getCamera(), fitCamera(extent, container.rect, limits, held));
    engine.dispose();
  });
});
