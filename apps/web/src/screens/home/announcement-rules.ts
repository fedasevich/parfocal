import type { AnnouncementKind } from "@parfocal/api-client";
import { daysBetween, formatClock, formatDayMonth } from "../format.ts";

export const maxLength = 280;

export const lasts = [
  { value: "ended", label: "Until I end it", hours: null },
  { value: "hour", label: "1 hour", hours: 1 },
  { value: "day", label: "1 day", hours: 24 },
  { value: "week", label: "1 week", hours: 168 },
] as const;

export type Lasts = (typeof lasts)[number]["value"];

export const kinds: { value: AnnouncementKind; label: string; hint: string }[] = [
  { value: "model", label: "New model", hint: "A model your people can now run." },
  { value: "slowdown", label: "Slowdown", hint: "A model server is slow, so runs queue." },
  { value: "change", label: "Change", hint: "A change in how Parfocal works." },
];

export const looks: Record<AnnouncementKind, { colour: string; source: string }> = {
  model: { colour: "var(--v-agree)", source: "Parfocal" },
  slowdown: { colour: "var(--warn)", source: "Lab server" },
  change: { colour: "var(--fg-faint)", source: "Viewer" },
};

export function endsAtFor(choice: Lasts, at: Date): string | null {
  const hours = lasts.find((option) => option.value === choice)?.hours ?? null;
  return hours === null ? null : new Date(at.getTime() + hours * 3_600_000).toISOString();
}

export function untilLabel(endsAt: string | null, at: Date): string | null {
  if (endsAt === null) return null;
  const end = new Date(endsAt);
  return daysBetween(at, end) === 0
    ? `until ${formatClock(end)}`
    : `until ${formatDayMonth(end)}, ${formatClock(end)}`;
}

export function textProblem(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "Write what you want to tell people.";
  if (trimmed.length > maxLength) return `Keep it to ${maxLength} characters.`;
  return undefined;
}
