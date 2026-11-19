import {
  defaultFakeQueueScene,
  type FakeQueueScene,
  fakeQueueScene,
} from "@parfocal/api-client/fake";

const scene = (patch: Partial<FakeQueueScene>): FakeQueueScene => ({
  ...defaultFakeQueueScene,
  ...patch,
});

const queueStages: Record<string, FakeQueueScene> = {
  open: scene({ stage: "open" }),
  sent: scene({ stage: "sent" }),
  adjudicated: scene({ stage: "adjudicated" }),
  locked: scene({ stage: "locked" }),
  declined: scene({ stage: "declined" }),
  edited: scene({ stage: "open", edited: true }),
  resolved: scene({ stage: "resolved" }),
};

const signOffScenes: Record<string, FakeQueueScene> = {
  blocked: scene({ stage: "locked" }),
  ready: scene({ stage: "resolved" }),
  ssofail: scene({ stage: "resolved" }),
  signed: scene({ stage: "resolved", signed: true }),
  amend: scene({ stage: "resolved", signed: true }),
};

const routePattern = /^\/tasks\/[^/]+\/(disagreements|adjudicate|sign-off|evaluation)\/?$/;

function queueStageFor(page: string, search: Record<string, unknown>): FakeQueueScene | null {
  const stage = typeof search["stage"] === "string" ? queueStages[search["stage"]] : undefined;
  if (stage !== undefined) return stage;
  if (fakeQueueScene() !== defaultFakeQueueScene) return null;
  return page === "adjudicate" ? scene({ stage: "sent" }) : scene({ stage: "open" });
}

export function fakeQueueSceneFor(
  pathname: string,
  search: Record<string, unknown>,
): FakeQueueScene | null {
  const page = routePattern.exec(pathname)?.[1];
  if (page === undefined) return defaultFakeQueueScene;
  if (page === "disagreements" || page === "adjudicate") return queueStageFor(page, search);
  const key = typeof search["scene"] === "string" ? search["scene"] : undefined;
  if (page === "evaluation") {
    return scene({ stage: "resolved", signed: true, retired: key === "retiredtpl" });
  }
  if (key === undefined) return null;
  return signOffScenes[key] ?? null;
}
