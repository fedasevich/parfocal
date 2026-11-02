import { workspaces } from "./scenario.ts";

const scenarioWorkspaceId = workspaces[0]?.id ?? null;

let active = scenarioWorkspaceId;

export function activeFakeWorkspace(): string | null {
  return active;
}

export function inScenarioWorkspace(): boolean {
  return active === scenarioWorkspaceId;
}

export function switchFakeWorkspace(tenantId: string): boolean {
  if (!workspaces.some((workspace) => workspace.id === tenantId)) return false;
  active = tenantId;
  return true;
}

export function resetFakeWorkspace(): void {
  active = scenarioWorkspaceId;
}
