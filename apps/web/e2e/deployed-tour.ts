import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";

const USAGE = [
  "Usage: pnpm --filter @parfocal/web deployed-tour [--app https://app.parfocal.eu] [--chapter N]",
  "Signs in with the agent-walk session from python3 scripts/agent_session.py,",
  "plays every chapter of the tour of the app, switching between the role accounts,",
  "and prints one line per step. --chapter N plays only chapter N.",
  "The server must have TOUR_ROLE_SWITCH set. GPU steps are skipped, never run.",
].join("\n");

const { values } = parseArgs({
  options: {
    app: { type: "string", default: "https://app.parfocal.eu" },
    state: { type: "string", default: join(homedir(), ".config/parfocal/agent-session.json") },
    chapter: { type: "string", default: "" },
    help: { type: "boolean", default: false },
  },
});

if (values.help || !existsSync(values.state)) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(values.help ? 0 : 1);
}

const shownBox = (page: Page, selector: string) =>
  page.evaluate((query) => {
    for (const one of query.split("\n")) {
      for (const element of document.querySelectorAll(one)) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        }
      }
    }
    return null;
  }, selector);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  storageState: values.state,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
let failures = 0;
let fallbackAnchors = 0;
const stepLimit = 60;

async function openMenu() {
  await page.goto(`${values.app}/`);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Tour of the app" }).click();
  return page.getByRole("dialog", { name: "Tour of the app" });
}

async function playOne(index: number, title: string) {
  const menu = await openMenu();
  await menu.getByRole("button", { name: `Play ${title}`, exact: true }).click();
  const bubble = page.getByTestId("tour-bubble");
  const ring = page.getByTestId("tour-ring");
  for (let count = 0; count < stepLimit; count += 1) {
    await bubble.waitFor({ timeout: 30_000 });
    const number = Number(await bubble.getAttribute("data-step"));
    const switchButton = bubble.getByTestId("tour-switch");
    if (await switchButton.isVisible()) {
      const loaded = page.waitForEvent("load", { timeout: 20_000 }).then(
        () => true,
        () => false,
      );
      await switchButton.click();
      await loaded;
      if (await bubble.getByTestId("tour-switch-failed").isVisible()) {
        throw new Error(`step ${number}: the server refused the role switch`);
      }
      await bubble.and(page.locator(`[data-step="${number}"]`)).waitFor({ timeout: 30_000 });
    }
    const anchor = (await bubble.getAttribute("data-anchor")) ?? "";
    const selector = (await bubble.getAttribute("data-selector")) ?? "";
    const gpu = (await bubble.getAttribute("data-gpu")) === "yes";
    const ringed = await ring.waitFor({ timeout: 20_000 }).then(
      () => true,
      () => false,
    );
    const box = selector ? await shownBox(page, selector) : null;
    const who = (await bubble.locator("p").nth(1).textContent()) ?? "";
    await page
      .waitForFunction(
        () =>
          document.querySelector('[data-testid="tour-bubble"]')?.getAttribute("data-route") !==
          "pending",
        undefined,
        { timeout: 20_000 },
      )
      .catch(() => undefined);
    const routeKind = (await bubble.getAttribute("data-route")) ?? "";
    const match = (await bubble.getAttribute("data-match")) ?? "";
    const ok = ringed && box !== null && routeKind === "exact" && match !== "none";
    if (match !== "0" && match !== "none") fallbackAnchors += 1;
    process.stdout.write(
      `${index + 1}.${number} ${anchor} ${ok ? "ringed" : "MISSING"} route=${routeKind} alternative=${match}${gpu ? " gpu-skipped" : ""} ${who.trim()} ${page.url()}\n`,
    );
    if (!ok) failures += 1;
    const advance = await bubble.getAttribute("data-advance");
    if (advance !== "next" && box !== null && !gpu) {
      await page.locator(selector.split("\n").join(",")).locator("visible=true").first().click();
    } else {
      await bubble.getByTestId("tour-next").click();
    }
    const gone = await bubble.waitFor({ state: "hidden", timeout: 1500 }).then(
      () => true,
      () => false,
    );
    if (gone) {
      await page.waitForLoadState("load");
      return;
    }
  }
  throw new Error(`chapter ${title} did not end in ${stepLimit} steps`);
}

try {
  const menu = await openMenu();
  const titles = (await menu.getByRole("button", { name: /^Play (?!all)/ }).allTextContents()).map(
    (text) => text.replace(/^Play /, ""),
  );
  for (const [index, title] of titles.entries()) {
    if (values.chapter !== "" && Number(values.chapter) !== index + 1) continue;
    process.stdout.write(`chapter ${index + 1} ${title}\n`);
    await playOne(index, title);
  }
} finally {
  await browser.close();
}
process.stdout.write(
  `${fallbackAnchors} steps ringed a fallback anchor, which is expected on refused and empty pages\n`,
);
process.stdout.write(
  failures === 0
    ? "every step resolved its seeded names and ringed its control\n"
    : `${failures} steps missed or used a stand-in seeded name\n`,
);
process.exit(failures === 0 ? 0 : 1);
