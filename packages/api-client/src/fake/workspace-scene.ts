import { workspaces } from "./scenario.ts";

const scenarioWorkspaceId = workspaces[0]?.id ?? null;

let active = scenarioWorkspaceId;
let suspendedSlug: string | null = null;

export function activeFakeWorkspace(): string | null {
  return active;
}

export function inScenarioWorkspace(): boolean {
  return active === scenarioWorkspaceId;
}

export type FakeSwitch = "switched" | "not-a-member" | "tenant-suspended";

export function switchFakeWorkspace(tenantId: string): FakeSwitch {
  const chosen = workspaces.find((workspace) => workspace.id === tenantId);
  if (chosen === undefined) return "not-a-member";
  if (chosen.slug === suspendedSlug) return "tenant-suspended";
  active = tenantId;
  return "switched";
}

export function setFakeSuspendedWorkspace(slug: string | null): void {
  suspendedSlug = slug;
}

export function resetFakeWorkspace(): void {
  active = scenarioWorkspaceId;
}
