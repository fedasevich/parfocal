const dayMs = 24 * 60 * 60 * 1000;

export function parseDay(day: string): Date {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

const longDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const shortDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const clockTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

export const formatLongDay = (at: Date) => longDay.format(at).replace(",", "");

export const formatDue = (day: string) => shortDay.format(parseDay(day)).replace(",", "");

export const formatDayMonth = (at: Date) => dayMonth.format(at);

export const formatWeekday = (day: string) => weekday.format(parseDay(day));

export const formatClock = (at: Date) => clockTime.format(at);

export function greeting(at: Date): string {
  const hour = at.getHours();
  if (hour < 12) return "Good morning";
  return hour < 18 ? "Good afternoon" : "Good evening";
}

const startOfDay = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate());

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / dayMs);
}

export function relativeDay(at: Date, today: Date): string {
  const days = daysBetween(at, today);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function relativeTime(at: Date, today: Date): string {
  const minutes = Math.round((today.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 120) return "1 h ago";
  const days = daysBetween(at, today);
  if (days === 0) return formatClock(at);
  if (days === 1) return "yesterday";
  return formatDayMonth(at);
}

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function andJoin(items: readonly string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((100 * part) / whole) : 0;
