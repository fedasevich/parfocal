import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const lenka = "00000000-0000-4000-8001-000000000001";
const simona = "00000000-0000-4000-8001-000000000003";
const daniel = "00000000-0000-4000-8001-000000000009";

test.use({ viewport: { width: 1280, height: 900 } });

const slideThread = (slideId: string, index: number, author: string, title: string, x: number) => {
  const at = `2026-10-15T1${index}:00:00+02:00`;
  const id = `00000000-0000-4000-8099-${slideId.slice(-6)}00000${index}`;
  return {
    thread: {
      id,
      project_id: p07,
      task_id: null,
      slide_id: slideId,
      title,
      anchor: {
        kind: "point",
        object_id: null,
        geometry: { type: "Point", coordinates: [x, 3000] },
        offset: null,
      },
      created_by: author,
      created_at: at,
      resolved_at: null,
      resolved_by: null,
      message_count: 1,
      last_message_at: at,
    },
    comment: {
      id: `00000000-0000-4000-8098-${slideId.slice(-6)}00000${index}`,
      thread_id: id,
      author_id: author,
      author_is_researcher: author === daniel,
      text: title,
      reply_to: null,
      created_at: at,
    },
  };
};

async function seedSlideThreads(page: Page) {
  const seeded = [
    slideThread(a1, 1, daniel, "Researcher asks about the margin", 2000),
    slideThread(a1, 2, simona, "Simona sees a micrometastasis", 3000),
    slideThread(a1, 3, lenka, "Lenka checks the capsule", 4000),
  ];
  const store = {
    threads: seeded.map((item) => item.thread),
    comments: seeded.map((item) => item.comment),
  };
  await page.addInitScript((kept) => {
    if (sessionStorage.getItem("parfocal.fake.posted-threads") === null) {
      sessionStorage.setItem("parfocal.fake.posted-threads", JSON.stringify(kept));
    }
  }, store);
}

test("a blinded reviewer sees no other reviewer's slide pin or thread before submitting", async ({
  page,
}) => {
  await seedSlideThreads(page);
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&tab=comments`);
  const cards = page.locator('[data-slot="thread-card"]');
  await expect(cards.filter({ hasText: "Researcher asks about the margin" })).toBeVisible();
  await expect(cards.filter({ hasText: "Lenka checks the capsule" })).toBeVisible();
  await expect(cards.filter({ hasText: "Simona sees a micrometastasis" })).toHaveCount(0);

  await page.goto(`/projects/${p07}/slides/${a1}/live?task=${rt14}&workspace=annotate`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(page.locator('[data-slot="comment-pin"]')).toHaveCount(2);
});
