import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { email, galleryProject, password, seededSlide, signIn } from "./session.ts";
import {
  type CellCollection,
  firstTypeableCell,
  gpuAnswer,
  gpuSmokeTimeoutMs,
  typedCellsFile,
  typedSlideLabel,
  typerWaitMs,
} from "./typing.ts";
import { report, watch } from "./watch.ts";

const viewSide = 512;
const embeddingBytes = 256 * 64 * 64 * 2;
const largeEncoder = "pathosam-vit-l-histopathology-fp32";
const largeDecoders = ["pathosam-vit-l.decoder.onnx", "pathosam-vit-l.decoder_window32.onnx"];

test.describe.configure({ timeout: gpuSmokeTimeoutMs });

async function viewAroundSeededNucleus(): Promise<{ x: number; y: number }> {
  const cells = JSON.parse(await readFile(typedCellsFile, "utf8")) as CellCollection;
  const points = firstTypeableCell(cells);
  expect(points, `${typedSlideLabel} has a labelled nucleus to click`).not.toBeNull();
  const ring = points as number[];
  const xs = ring.filter((_, index) => index % 2 === 0);
  const ys = ring.filter((_, index) => index % 2 === 1);
  const centre = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;
  return {
    x: Math.max(0, Math.round(centre(xs) - viewSide / 2)),
    y: Math.max(0, Math.round(centre(ys) - viewSide / 2)),
  };
}

async function embedView(
  page: Page,
  origin: string,
  slideId: string,
  at: { x: number; y: number },
) {
  const { response, retried } = await gpuAnswer(
    (call) =>
      page.request.post(`/api/slides/${slideId}/embeddings/view`, {
        data: { ...at, width: viewSide, height: viewSide },
        headers: { origin },
        params: call === null ? {} : { call },
        timeout: typerWaitMs,
      }),
    (ms) => page.waitForTimeout(ms),
  );
  const status = response.status();
  const again = retried ? " after one retry" : "";
  expect(
    status,
    `the encoder answered ${status}${again}: ${(await response.text()).slice(0, 300)}`,
  ).toBe(200);
  return response;
}

test("Best gets a ViT-L embedding of the clicked view from the server on the deployed app", async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(
    email === "" || password === "",
    "PARFOCAL_SMOKE_EMAIL and PARFOCAL_SMOKE_PASSWORD are not set",
  );
  const origin = baseURL ?? "";
  const seen = await watch(context, origin);
  seen.step("sign-in");
  await signIn(page, origin);
  seen.signedIn();

  const project = await galleryProject(page);
  const slideId = await seededSlide(page, project, typedSlideLabel);

  seen.step("decoders");
  for (const name of largeDecoders) {
    const head = await page.request.head(`/models/${name}`);
    expect(head.status(), `${name} is served`).toBe(200);
  }

  seen.step("embedding");
  const started = Date.now();
  const response = await embedView(page, origin, slideId, await viewAroundSeededNucleus());
  expect(response.headers()["parfocal-encoder"]).toBe(largeEncoder);
  expect((await response.body()).byteLength).toBe(embeddingBytes);
  info.annotations.push({
    type: "embedded",
    description: `${largeEncoder} answered in ${Date.now() - started} ms`,
  });

  expect(seen.problems, report(seen.problems)).toEqual([]);
});
