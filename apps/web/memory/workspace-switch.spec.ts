import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type HeapBudget,
  type HeapPoint,
  trendMarkdown,
  trendReport,
} from "@parfocal/viewer-engine/heap-trend";
import { type CDPSession, expect, type Page, test } from "@playwright/test";

const reportDir = fileURLToPath(new URL("../test-results/memory-reports", import.meta.url));
const warmUpRounds = 2;
const rounds = Number(process.env.MEMORY_WORKSPACE_ROUNDS ?? 20);
const budget: HeapBudget = { maxGrowth: null, maxSlopeBytesPerVisit: null };

const home = "Fakultní nemocnice Vltava";
const lab = "Charles University AI Lab";

const switcher = (page: Page) => page.locator('[data-slot="workspace-switch"]');

async function switchTo(page: Page, workspace: string, shown: string): Promise<void> {
  await switcher(page).click();
  await page.getByRole("menuitem", { name: new RegExp(workspace) }).click();
  await expect(switcher(page)).toContainText(workspace);
  await expect(page.getByText(shown)).toBeVisible();
}

async function settledHeap(cdp: CDPSession): Promise<number> {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  return (await cdp.send("Runtime.getHeapUsage")).usedSize;
}

async function writeHeapSnapshot(cdp: CDPSession, name: string): Promise<void> {
  const chunks: string[] = [];
  const collect = ({ chunk }: { chunk: string }) => {
    chunks.push(chunk);
  };
  cdp.on("HeapProfiler.addHeapSnapshotChunk", collect);
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  cdp.off("HeapProfiler.addHeapSnapshotChunk", collect);
  writeFileSync(join(reportDir, `${name}.heapsnapshot`), chunks.join(""));
}

test(`${rounds} workspace round trips are measured for heap growth`, async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(reportDir, { recursive: true });
  await page.goto("/my-work?tab=review");
  await expect(switcher(page)).toContainText(home);
  await expect(page.getByText("Continue reviewing")).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  const points: HeapPoint[] = [];
  for (let round = 0; round <= warmUpRounds + rounds; round += 1) {
    await switchTo(page, lab, "Nothing to review. New tasks show here.");
    await switchTo(page, home, "Continue reviewing");
    points.push({ visit: round, heapBytes: await settledHeap(cdp) });
    if (round === warmUpRounds || round === warmUpRounds + rounds) {
      await writeHeapSnapshot(cdp, `workspace-switches-round-${round}`);
    }
  }
  await cdp.detach();
  const report = trendReport(`${rounds} workspace round trips`, points, warmUpRounds, budget);
  writeFileSync(
    join(reportDir, "workspace-switches.trend.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(trendMarkdown([report]));
  expect(points).toHaveLength(warmUpRounds + rounds + 1);
  expect(report.check.failures).toEqual([]);
});
