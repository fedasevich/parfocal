import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";

const USAGE = [
  "Usage: pnpm --filter @parfocal/web deployed-tour [--app https://app.parfocal.eu]",
  "Signs in with the agent-walk session from python3 scripts/agent_session.py,",
  "plays chapters 1 and 2 of the tour of the app across the role switch and",
  "prints one line per step. The server must have TOUR_ROLE_SWITCH set.",
].join("\n");

const { values } = parseArgs({
  options: {
    app: { type: "string", default: "https://app.parfocal.eu" },
    state: { type: "string", default: join(homedir(), ".config/parfocal/agent-session.json") },
    steps: { type: "string", default: "12" },
    help: { type: "boolean", default: false },
  },
});

if (values.help || !existsSync(values.state)) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(values.help ? 0 : 1);
}

const shownBox = (page: Page, anchor: string) =>
  page.evaluate((name) => {
    for (const element of document.querySelectorAll(`[data-tour="${name}"]`)) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      }
    }
    return null;
  }, anchor);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  storageState: values.state,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
let failures = 0;
try {
  await page.goto(`${values.app}/`);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Tour of the app" }).click();
  await page
    .getByRole("dialog", { name: "Tour of the app" })
    .getByRole("button", { name: "Play all" })
    .click();
  const bubble = page.getByTestId("tour-bubble");
  for (let number = 1; number <= Number(values.steps); number += 1) {
    await bubble.and(page.locator(`[data-step="${number}"]`)).waitFor({ timeout: 30_000 });
    const switchButton = bubble.getByRole("button", { name: /^Switch to the / });
    if (await switchButton.isVisible()) {
      await switchButton.click();
      await page.waitForLoadState("load");
      if (await bubble.getByTestId("tour-switch-failed").isVisible()) {
        throw new Error(`step ${number}: the server refused the role switch`);
      }
      await bubble.and(page.locator(`[data-step="${number}"]`)).waitFor({ timeout: 30_000 });
    }
    const ring = page.getByTestId("tour-ring");
    const ringed = await ring.waitFor({ timeout: 20_000 }).then(
      () => true,
      () => false,
    );
    const anchor = await page.evaluate(
      () =>
        document.querySelector('[data-testid="tour-bubble"]')?.getAttribute("data-anchor") ?? "",
    );
    const box = anchor ? await shownBox(page, anchor) : null;
    const who = (await bubble.locator("p").nth(1).textContent()) ?? "";
    process.stdout.write(
      `${number} ${anchor} ${ringed && box ? "ringed" : "MISSING"} ${who.trim()} ${page.url()}\n`,
    );
    if (!ringed || box === null) failures += 1;
    const advance = await bubble.getAttribute("data-advance");
    if (advance !== "next" && box !== null) {
      await page.locator(`[data-tour="${anchor}"]:visible`).first().click();
    } else {
      await bubble.getByRole("button", { name: /^(Next|Done)$/ }).click();
    }
  }
  await bubble.waitFor({ state: "hidden", timeout: 30_000 });
} finally {
  await browser.close();
}
process.stdout.write(
  failures === 0 ? "every step ringed its control\n" : `${failures} steps missed\n`,
);
process.exit(failures === 0 ? 0 : 1);
