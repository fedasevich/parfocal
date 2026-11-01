import { defaultFakeTeamScene, type FakeTeamScene, scenarioTask } from "@parfocal/api-client/fake";

export function fakeTeamSceneFor(pathname: string, search: Record<string, unknown>): FakeTeamScene {
  if (pathname !== "/team") return defaultFakeTeamScene;
  const scene = search["scene"];
  if (scene === "overdue") return { ...defaultFakeTeamScene, now: "overdue" };
  if (scene === "away") return { ...defaultFakeTeamScene, away: "AK" };
  if (scene === "sent" || search["task"] === scenarioTask.newTask.id) {
    return { ...defaultFakeTeamScene, sent: true };
  }
  return defaultFakeTeamScene;
}
