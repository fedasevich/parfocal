import { defaultFakeQueueScene, type FakeQueueScene } from "@parfocal/api-client/fake";

const scene = (patch: Partial<FakeQueueScene>): FakeQueueScene => ({
  ...defaultFakeQueueScene,
  ...patch,
});

const queueScenes: Record<string, FakeQueueScene> = {
  queue: scene({ stage: "open" }),
  selected: scene({ stage: "open" }),
  sendadj: scene({ stage: "open" }),
  sent: scene({ stage: "sent" }),
  adjudicate: scene({ stage: "sent" }),
  adjdone: scene({ stage: "adjudicated" }),
  lockedqueue: scene({ stage: "locked" }),
  declined: scene({ stage: "declined" }),
  edited: scene({ stage: "open", edited: true }),
};

const signOffScenes: Record<string, FakeQueueScene> = {
  blocked: scene({ stage: "locked" }),
  ready: scene({ stage: "resolved" }),
  ssofail: scene({ stage: "resolved" }),
  signed: scene({ stage: "resolved", signed: true }),
  amend: scene({ stage: "resolved", signed: true }),
};

const routePattern = /^\/tasks\/[^/]+\/(disagreements|sign-off|evaluation)\/?$/;

export function fakeQueueSceneFor(
  pathname: string,
  search: Record<string, unknown>,
): FakeQueueScene | null {
  const page = routePattern.exec(pathname)?.[1];
  if (page === undefined) return defaultFakeQueueScene;
  const key = typeof search["scene"] === "string" ? search["scene"] : undefined;
  if (page === "evaluation") {
    return scene({ stage: "resolved", signed: true, retired: key === "retiredtpl" });
  }
  if (key === undefined) return null;
  return (page === "disagreements" ? queueScenes[key] : signOffScenes[key]) ?? null;
}
