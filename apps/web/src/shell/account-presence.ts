import type { AvailabilityChange, MemberAvailability } from "@parfocal/api-client";
import type { PersonInfo } from "@parfocal/ui/components/person";

export type AccountPresenceView = {
  key: "available" | "away";
  label: string;
  hint: string;
  tone: string;
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

export function nextAvailability(
  availability: MemberAvailability | undefined,
  now: Date,
): AvailabilityChange {
  return isAway(availability, now) ? { status: "available" } : { status: "away" };
}

export function shownPerson(person: PersonInfo, initialsOnly: boolean): PersonInfo {
  return initialsOnly ? { ...person, name: person.initials } : person;
}
