import type { AvailabilityChange, MemberAvailability } from "@parfocal/api-client";
import type { PersonInfo, Presence } from "@parfocal/ui/components/person";

export type AccountPresenceView = {
  key: "available" | "busy" | "away";
  label: string;
  hint: string;
  tone: string;
};

const busyView: AccountPresenceView = {
  key: "busy",
  label: "Busy",
  hint: "Reachable, but not taking new review tasks right now",
  tone: "bg-warn",
};

const dayAndTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const isAway = (availability: MemberAvailability | undefined, now: Date): boolean =>
  availability?.status === "away" &&
  (availability.until === null || new Date(availability.until).getTime() > now.getTime());

export function presenceOf(
  availability: MemberAvailability | undefined,
  now: Date,
): AccountPresenceView {
  if (availability?.status === "busy") return busyView;
  if (!availability || !isAway(availability, now)) {
    return {
      key: "available",
      label: "Available",
      hint: "Researchers can give you review tasks",
      tone: "bg-ok",
    };
  }
  return {
    key: "away",
    label: availability.until
      ? `Away until ${dayAndTime.format(new Date(availability.until))}`
      : "Away",
    hint: availability.note ?? "Team shows you as away, so tasks can be reassigned",
    tone: "bg-fg-faint",
  };
}

export const presenceChoices: readonly AccountPresenceView[] = [
  {
    key: "available",
    label: "Available",
    hint: "Researchers can give you review tasks",
    tone: "bg-ok",
  },
  busyView,
  {
    key: "away",
    label: "Away",
    hint: "Team shows you as away, so tasks can be reassigned",
    tone: "bg-fg-faint",
  },
];

export function availabilityChange(
  key: Presence,
  availability: MemberAvailability | undefined,
  now: Date,
): AvailabilityChange | null {
  if (presenceOf(availability, now).key === key) return null;
  return { status: key };
}

export function shownPerson(person: PersonInfo, initialsOnly: boolean): PersonInfo {
  return initialsOnly ? { ...person, name: person.initials } : person;
}
