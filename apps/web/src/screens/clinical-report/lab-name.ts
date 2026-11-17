import { useGetMe } from "@parfocal/api-client";
import { okData } from "../placeholder.tsx";

export function useLabName(): string {
  const me = okData(useGetMe().data);
  return me?.workspaces.find((item) => item.tenant_id === me.active_tenant_id)?.name ?? "";
}
