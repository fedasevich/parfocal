import { test } from "@playwright/test";
import { presetRun, walkRound5 } from "../e2e/study-round5-walk.ts";
import { signIn } from "./session.ts";

const code = process.env["PARFOCAL_STUDY_CODE"] ?? "";

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 45_000 });

test("a seeded participant reaches every round 5 task's success on the deployed app", async ({
  page,
  baseURL,
}) => {
  test.skip(code === "", "PARFOCAL_STUDY_CODE names the seeded participant code");
  test.setTimeout(900_000);
  await signIn(page, baseURL ?? "https://app.parfocal.eu");
  await presetRun(page, code.toUpperCase());
  await walkRound5(page, {
    code: code.toUpperCase(),
    reviewSlideLink: (on) => on.getByRole("link", { name: /^Study review 1\b/ }),
    secondSlide: /^Study review 2\b/,
  });
});
