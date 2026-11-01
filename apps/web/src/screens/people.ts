import { type Member, useListTenantMembers } from "@parfocal/api-client";
import type { PersonInfo } from "@parfocal/ui/components/person";
import { avatarColour } from "@parfocal/ui/lib/avatar-colours";
import { okData } from "./placeholder.tsx";

export const toPersonInfo = (
  member: Pick<Member, "display_name" | "initials" | "avatar_colour" | "title">,
): PersonInfo => ({
  name: member.display_name,
  initials: member.initials,
  color: avatarColour(member.avatar_colour),
  ...(member.title ? { role: member.title } : {}),
});

export function usePeople(): (userId: string | null | undefined) => PersonInfo | undefined {
  const members = okData(useListTenantMembers().data) ?? [];
  const byId = new Map(members.map((member) => [member.user_id, toPersonInfo(member)]));
  return (userId) => (userId ? byId.get(userId) : undefined);
}

export const personProp = (person: PersonInfo | undefined) => (person ? { person } : {});
