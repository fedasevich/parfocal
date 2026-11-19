import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";
const rt09 = "00000000-0000-4000-8007-000000000009";
const sampleProject = "00000000-0000-4000-8003-000000000001";
const tumor001 = "00000000-0000-4000-8005-000000000101";

test.use({ viewport: { width: 1440, height: 900 } });

const viewerOf = (task: string, issue?: string) =>
  `/projects/${p07}/slides/${a1}?task=${task}${issue === undefined ? "" : `&issue=${issue}`}`;

async function ready(page: Page) {
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
}

async function answersOff(page: Page, reason: string) {
  const row = page.getByTestId("stage-review-objects").getByTestId("object-row").first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button").click();
  const foot = page.getByTestId("object-foot");
  const answers = foot.getByRole("group").getByRole("button");
  await expect(answers.first()).toBeVisible();
  for (const button of await answers.all()) await expect(button).toBeDisabled();
  await expect(foot.getByTestId("answers-off")).toHaveText(reason);
}

test("a slide with no result says so on the slide and moves to the next slide", async ({
  page,
}) => {
  await page.goto(viewerOf(rt14, "noresults"));
  await ready(page);
  const card = page.getByTestId("stage-issue");
  await expect(card).toHaveAttribute("data-issue", "noresults");
  await expect(card).toContainText(/No AI result on .+ yet\./);
  await expect(card).toContainText(
    "Review the slide without AI, or ask the researcher to run the model.",
  );
  await card.getByRole("button", { name: "Next slide" }).click();
  await expect(page).not.toHaveURL(new RegExp(a1));
});

test("a withdrawn task says so on the slide, locks the answers and goes back to My work", async ({
  page,
}) => {
  await page.goto(viewerOf(rt14, "withdrawn"));
  await ready(page);
  const card = page.getByTestId("stage-issue");
  await expect(card).toHaveAttribute("data-issue", "withdrawn");
  await expect(card).toContainText("This task was withdrawn.");
  await page.getByRole("tab", { name: "Objects" }).click();
  await answersOff(page, "This task was withdrawn. There is nothing left to decide.");
  await card.getByRole("button", { name: "Back to My work" }).click();
  await expect(page).toHaveURL(/\/my-work/);
});

test("a slide the API flags as unreadable at high power says so before any tile fails", async ({
  page,
}) => {
  await page.goto(viewerOf(rt14, "slidefail"));
  await ready(page);
  const card = page.getByTestId("stage-issue");
  await expect(card).toHaveAttribute("data-issue", "slidefail", { timeout: 15_000 });
  await expect(card).toContainText(/could not be read at the highest magnifications\./);
  await expect(card.getByRole("button", { name: "Ask the researcher" })).toBeVisible();
  await card.getByRole("button", { name: "Retry" }).click();
  await expect(card).toHaveCount(0, { timeout: 15_000 });
});

test("a signed off task shows the read only banner, locks the answers and asks for an amendment", async ({
  page,
}) => {
  await page.goto(viewerOf(rt09));
  await ready(page);
  const notice = page.getByTestId("viewer-banner").getByTestId("signed-off-notice");
  await expect(notice).toContainText("Signed off 9 Oct. Changes need an amendment.", {
    timeout: 15_000,
  });
  await answersOff(page, "Signed off. Ask the researcher to amend.");
  await notice.getByRole("button", { name: /^Ask .+ to amend$/ }).click();
  await expect(page).toHaveURL(/tab=comments/);
});

test("an AI run still reading shows its panel and the switch to be told when it is ready", async ({
  page,
}) => {
  await page.goto(viewerOf(rt14, "running"));
  await ready(page);
  const reading = page.getByTestId("stage-ai-reading");
  await expect(reading).toHaveAttribute("data-state", "running", { timeout: 15_000 });
  await expect(reading).toContainText(/Still reading this slide, \d+ regions so far/);
  const tell = reading.getByRole("switch");
  await expect(tell).toHaveAttribute("aria-checked", "false");
  await reading.getByText("Tell me when it is ready").click();
  await expect(tell).toHaveAttribute("aria-checked", "true");
});

test("a slide whose highest magnification fails says so on the slide and retries", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { armed: true };
    Object.assign(window, { tileFault: state });
    const post = Object.getOwnPropertyDescriptor(Worker.prototype, "postMessage")?.value as (
      this: Worker,
      ...args: unknown[]
    ) => void;
    Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
      const read = message as { type?: string; region?: { backing: number } };
      if (state.armed && read?.type === "read" && (read.region?.backing ?? 9) < 2) {
        return post.call(this, { ...read, region: { ...read.region, backing: 99 } }, ...rest);
      }
      return post.call(this, message, ...rest);
    };
  });
  await page.goto(`/projects/${sampleProject}/slides/${tumor001}/live`);
  await ready(page);
  const card = page.getByTestId("stage-issue");
  await expect(card).toHaveAttribute("data-issue", "slidefail", { timeout: 15_000 });
  await expect(card).toContainText(/could not be read at the highest magnifications\./);
  await expect(card).toContainText("Tiles are missing on the server.");
  await page.evaluate(() => {
    (window as unknown as { tileFault: { armed: boolean } }).tileFault.armed = false;
  });
  await card.getByRole("button", { name: "Retry" }).click();
  await expect(card).toHaveCount(0, { timeout: 15_000 });
});
