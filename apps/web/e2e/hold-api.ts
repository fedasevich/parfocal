import type { Page } from "./a11y.ts";

export async function holdApi(page: Page, part = "/api/") {
  await page.addInitScript((heldPart) => {
    const original = window.fetch.bind(window);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { releaseApi: () => release() });
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
      const session =
        heldPart === "/api/" && new URL(url, location.href).pathname.endsWith("/api/me");
      if (url.includes(heldPart) && !session) await held;
      return original(input, init);
    };
  }, part);
}

export const releaseApi = (page: Page) =>
  page.evaluate(() => (window as unknown as { releaseApi: () => void }).releaseApi());
