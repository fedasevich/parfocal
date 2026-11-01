import { type Member, useListTenantMembers } from "@parfocal/api-client";
import type { PersonInfo } from "@parfocal/ui/components/person";
import { avatarColour } from "@parfocal/ui/lib/avatar-colours";
import { okData } from "../placeholder.tsx";

export const toPersonInfo = (member: Member): PersonInfo => ({
  initials: member.initials,
  name: member.display_name,
  color: avatarColour(member.avatar_colour),
  ...(member.title ? { role: member.title } : {}),
});

export const unknownPerson: PersonInfo = { initials: "?", name: "Someone", color: avatarColour(5) };

export function usePeople() {
  const members = okData(useListTenantMembers().data) ?? [];
  const byId = new Map(members.map((member) => [member.user_id, toPersonInfo(member)]));
  const byInitials = new Map(members.map((member) => [member.initials, toPersonInfo(member)]));
  return {
    members,
    byId: (id: string | null | undefined) => (id ? byId.get(id) : undefined) ?? unknownPerson,
    byInitials: (initials: string) => byInitials.get(initials) ?? unknownPerson,
  };
}

export const firstName = (person: PersonInfo) => person.name.split(" ")[0] ?? person.name;
