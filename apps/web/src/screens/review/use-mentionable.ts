import { useListTenantMembers } from "@parfocal/api-client";
import { toPersonInfo } from "../people.ts";
import { okData } from "../placeholder.tsx";
import type { Mentionable } from "./mention-picking.ts";

export function useMentionable(): Mentionable[] {
  const members = okData(useListTenantMembers().data) ?? [];
  return members.map((member) => ({
    id: member.user_id,
    name: member.display_name,
    person: toPersonInfo(member),
    sub: member.title ?? "",
  }));
}
