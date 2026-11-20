import assert from "node:assert/strict";
import { test } from "node:test";
import type { SearchHit, SlideRow } from "@parfocal/api-client";
import { slideOpenPath } from "../src/screens/my-work/list-keys.ts";
import { destinations } from "../src/shell/destinations.ts";
import { hitHref } from "../src/shell/search-hits.ts";
import { slideHref, slideLink } from "../src/shell/slide-link.ts";

const projectId = "p1";
const slideId = "s1";
const plain = `/projects/${projectId}/slides/${slideId}`;

test("one helper builds the slide address with no workspace and no second route", () => {
  assert.equal(slideHref({ projectId, slideId }), plain);
  assert.equal(slideHref({ projectId, slideId, taskId: "t1" }), `${plain}?task=t1`);
  assert.equal(
    slideHref({ projectId, slideId, taskId: "t1", object: "T4", view: { x: 1, y: 2, z: 3 } }),
    `${plain}?task=t1&object=T4&x=1&y=2&z=3`,
  );
  const link = slideLink({ projectId, slideId, taskId: "t1" });
  assert.equal(link.to, "/projects/$projectId/slides/$slideId");
  assert.deepEqual(link.params, { projectId, slideId });
  assert.ok(!("workspace" in link.search));
});

test("search, My work, home and the shell all reach the slide through the same address", () => {
  const hit = {
    kind: "slide",
    id: slideId,
    slide_id: slideId,
    project: { id: projectId },
    task_id: null,
    object_id: null,
  } as unknown as SearchHit;
  const row = { id: slideId, project: { id: projectId }, reviews: [] } as unknown as SlideRow;
  const addresses = [
    destinations.slide(projectId, slideId),
    hitHref(hit),
    slideOpenPath(row, "me"),
    slideHref({ projectId, slideId }),
  ];
  for (const address of addresses) assert.equal(address, plain);
});

test("a slide of my task opens with the task, and an in review slide opens guided", () => {
  const row = (state: string) =>
    ({
      id: slideId,
      project: { id: projectId },
      reviews: [{ user_id: "me", task_id: "t1", state }],
    }) as unknown as SlideRow;
  assert.equal(slideOpenPath(row("not-started"), "me"), `${plain}?task=t1`);
  assert.equal(slideOpenPath(row("in-review"), "me"), destinations.guided("t1", slideId));
  assert.equal(slideOpenPath(row("not-started"), "other"), plain);
});
