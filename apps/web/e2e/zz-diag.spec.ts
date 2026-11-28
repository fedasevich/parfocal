import { expect, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const withResults = "00000000-0000-4000-8005-000000000005";
const scoped = ["C1", "C2", "C3", "C4", "C5"];

test.use({ viewport: { width: 1440, height: 900 } });

test("diag", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const log: unknown[] = [];
    w["diagLog"] = log;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        const a = performance.now();
        cb(t);
        const d = performance.now() - a;
        if (d > 2) log.push(["raf", Math.round(a), Math.round(d)]);
      });
    const proto = WebGL2RenderingContext.prototype as unknown as Record<string, unknown>;
    for (const name of [
      "clear",
      "readPixels",
      "drawArrays",
      "drawElements",
      "texImage2D",
      "texSubImage2D",
      "texStorage2D",
      "drawArraysInstanced",
      "drawElementsInstanced",
      "finish",
      "flush",
    ]) {
      const original = proto[name] as (...args: unknown[]) => unknown;
      proto[name] = function (this: unknown, ...args: unknown[]) {
        const a = performance.now();
        const out = original.apply(this, args);
        log.push([name, Math.round(a), Math.round((performance.now() - a) * 10) / 10]);
        return out;
      };
    }
  });
  await page.goto(`/projects/${p07}/slides/${withResults}?task=${annotateTask}&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(page.getByTestId("ai-object")).toHaveCount(6);
  await page.keyboard.press("Shift+G");
  const guide = page.getByTestId("guided-check");
  await expect(guide).toHaveAttribute("data-current", "C1");
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const log = w["diagLog"] as unknown[];
    const node = document.querySelector('[data-testid="guided-check"]');
    const host = document.querySelector('[data-testid="slide-host"]') as HTMLElement | null;
    if (node === null) throw new Error("no guide");
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "d")
          log.push(["KEY " + (host?.dataset["camera"] ?? ""), Math.round(event.timeStamp), 0]);
      },
      { capture: true },
    );
    new MutationObserver(() => {
      log.push(["MUT", Math.round(performance.now()), 0]);
      requestAnimationFrame(() => {
        log.push(["RAF1", Math.round(performance.now()), 0]);
        requestAnimationFrame(() => log.push(["DONE", Math.round(performance.now()), 0]));
      });
    }).observe(node, { attributes: true, attributeFilter: ["data-current"] });
  });
  for (const next of scoped.slice(1)) {
    await page.keyboard.press("d");
    await expect(guide).toHaveAttribute("data-current", next);
  }
  await page.waitForTimeout(2500);
  const log = (await page.evaluate(
    () => (window as unknown as Record<string, unknown>)["diagLog"],
  )) as [string, number, number][];
  const firstKey = log.findIndex((e) => e[0].startsWith("KEY"));
  const out: string[] = [];
  let run: { name: string; n: number; t: number; d: number } | null = null;
  const flush = () => {
    if (run !== null) out.push(`${run.t} ${run.name} x${run.n} ${run.d.toFixed(1)}ms`);
    run = null;
  };
  const single = /^(KEY|MUT|RAF1|DONE|raf)/;
  for (const [name, t, d] of log.slice(firstKey)) {
    if (run !== null && run.name === name && !single.test(name)) {
      run.n += 1;
      run.d += d;
      continue;
    }
    flush();
    run = { name, n: 1, t, d };
  }
  flush();
  console.log(`DIAG camera ${await page.getByTestId("slide-host").getAttribute("data-camera")}`);
  console.log(out.map((line) => `DIAG ${line}`).join("\n"));
});
