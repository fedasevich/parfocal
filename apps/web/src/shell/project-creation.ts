import type { Me } from "@parfocal/api-client";

export function canCreateProjects(me: Me | undefined): boolean {
  const membership = me?.workspaces.find((item) => item.tenant_id === me.active_tenant_id);
  return membership?.role !== "study-participant";
}
