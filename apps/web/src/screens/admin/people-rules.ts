import type { Invitation, Member, MemberActivity } from "@parfocal/api-client";

export type PeopleFilter = "all" | "res" | "rev" | "adm";

export type AdminSwitch = "absent" | "locked" | "on" | "off";

export function adminSwitchOf(role: Member["role"], holds: boolean, holders: number): AdminSwitch {
  if (role !== "researcher") return "absent";
  if (holds && holders <= 1) return "locked";
  return holds ? "on" : "off";
}

export function shownInvitations(
  invitations: Invitation[],
  find: string,
  filter: PeopleFilter,
): Invitation[] {
  if (filter !== "all") return [];
  const needle = find.trim().toLowerCase();
  return invitations.filter((invitation) => invitation.email.includes(needle));
}

export function takenEmails(activity: MemberActivity[], invitations: Invitation[]): string[] {
  return [
    ...activity.flatMap((row) => (row.email === null ? [] : [row.email.toLowerCase()])),
    ...invitations.map((invitation) => invitation.email),
  ];
}
