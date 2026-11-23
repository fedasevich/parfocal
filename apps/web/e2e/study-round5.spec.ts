import { test } from "./a11y.ts";
import { presetRun, walkRound5 } from "./study-round5-walk.ts";

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 30_000 });

const code = "P-FAKE";
const reviewSlide = "00000000-0000-4000-8005-000000000001";

test("every round 5 task starts in the participant project and reaches its success", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await presetRun(page, code);
  await walkRound5(page, {
    code,
    reviewSlideLink: (on) => on.locator(`a[href$="/slides/${reviewSlide}"]`),
    secondSlide: /^A2/,
  });
});
