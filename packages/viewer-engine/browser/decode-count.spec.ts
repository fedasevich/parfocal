import { expect, test } from "@playwright/test";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import { cmu1TissueCentre } from "../../golden-images/render/viv-scenes.ts";
import { harnessUrl } from "./cdp.ts";
import type { DecodeCountReport } from "./page/decode-count-harness.ts";

const availability = fixtureAvailability("CMU-1.svs");

const views = [
  { name: "fitted", magnification: null },
  { name: "10x", magnification: 10 },
] as const;

for (const view of views) {
  test(`Viv reads every region of CMU-1.svs once at the ${view.name} view, not once per channel`, async ({
    page,
  }) => {
    test.skip(availability.status === "missing", "fixture not downloaded");
    await page.goto(harnessUrl("/app/decode-count.html"));
    await page.waitForFunction(() => window.decodeCountHarness !== undefined);
    const run = (workers: number): Promise<DecodeCountReport> =>
      page.evaluate((request) => window.decodeCountHarness.run(request), {
        url: harnessUrl("/cache/CMU-1.svs"),
        formatId: "aperio-svs" as const,
        workers,
        magnification: view.magnification,
        ...cmu1TissueCentre,
      });
    const onPage = await run(0);
    expect(onPage.errors).toEqual([]);
    expect(onPage.tileRequests).toBe(0);
    expect(onPage.rasterRequests).toBeGreaterThanOrEqual(9);
    expect(onPage.mostReadsOfOneRegion).toBe(1);
    expect(onPage.distinctReads).toBe(onPage.rasterRequests);
    const inWorkers = await run(6);
    expect(inWorkers.errors).toEqual([]);
    expect(inWorkers.dispatchedToWorkers).toBe(onPage.rasterRequests);
    console.log(
      `${view.name}: ${onPage.rasterRequests} region reads for ${onPage.distinctReads} regions, most reads of one region ${onPage.mostReadsOfOneRegion}, ${inWorkers.dispatchedToWorkers} dispatched to workers`,
    );
  });
}
