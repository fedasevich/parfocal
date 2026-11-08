import type { Me } from "@parfocal/api-client";

export function canUseDeveloperMode(me: Me | undefined): boolean {
  if (me === undefined) return false;
  const membership = me.workspaces.find((item) => item.tenant_id === me.active_tenant_id);
  return membership?.role === "researcher";
}

export function wantsLab(search: string): boolean {
  return new URLSearchParams(search).has("lab");
}
