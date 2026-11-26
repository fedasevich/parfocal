import type { Invitation, Member, MemberActivity } from "@parfocal/api-client";

export type PeopleFilter = "all" | "res" | "rev" | "adm";

export type AdminSwitch = "absent" | "locked" | "on" | "off";

export function adminSwitchOf(role: Member["role"], holds: boolean, holders: number): AdminSwitch {
  if (role !== "researcher") return "absent";
  if (holds && holders <= 1) return "locked";
  return holds ? "on" : "off";
}

export type MemberAction =
  | "make-researcher"
  | "make-reviewer"
  | "give-admin"
  | "remove-admin"
  | "cancel-removal"
  | "remove";

export function memberActionsOf(person: {
  role: Member["role"];
  holdsRight: boolean;
  holders: number;
  isViewer: boolean;
  deactivated: boolean;
  scheduled: boolean;
}): MemberAction[] {
  if (person.deactivated) return [];
  const actions: MemberAction[] = [];
  const admin = adminSwitchOf(person.role, person.holdsRight, person.holders);
  if (person.role === "reviewer") actions.push("make-researcher");
  if (person.role === "researcher" && !person.holdsRight) actions.push("make-reviewer");
  if (admin === "on") actions.push("remove-admin");
  if (admin === "off") actions.push("give-admin");
  if (person.scheduled) actions.push("cancel-removal");
  else if (!person.isViewer && admin !== "locked") actions.push("remove");
  return actions;
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
