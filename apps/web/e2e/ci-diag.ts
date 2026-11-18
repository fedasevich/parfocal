import type { Page } from "@playwright/test";

type DiagWindow = {
  __rafGaps?: [number, number][];
  __diagFrom?: number;
  __vivDiag?: {
    draws: [number, number][];
    device?: unknown;
    software?: boolean;
    motions: number;
    movingMotions: number;
  };
};

export async function startFrameDiag(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as DiagWindow;
    const gaps: [number, number][] = [];
    w.__rafGaps = gaps;
    w.__diagFrom = performance.now();
    let last = performance.now();
    const tick = (at: number) => {
      gaps.push([Math.round(at), Math.round(at - last)]);
      last = at;
      if (gaps.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export async function printFrameDiag(page: Page, label: string) {
  const info = await page.evaluate(() => {
    const w = window as unknown as DiagWindow;
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer: unknown =
      gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    const from = w.__diagFrom ?? 0;
    const viv = w.__vivDiag;
    return {
      now: Math.round(performance.now()),
      from: Math.round(from),
      visibility: document.visibilityState,
      focus: document.hasFocus(),
      renderer: String(renderer),
      device: viv?.device,
      software: viv?.software,
      motions: viv?.motions,
      movingMotions: viv?.movingMotions,
      rafGaps: (w.__rafGaps ?? []).slice(0, 80),
      draws: (viv?.draws ?? []).filter(([at]) => at >= from).slice(0, 80),
    };
  });
  console.log(`[ci-diag ${label}] ${JSON.stringify(info)}`);
}
