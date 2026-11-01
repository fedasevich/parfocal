import type { TeamReviewer, TeamTask, TeamWorkload } from "@parfocal/api-client";
import {
  andJoin,
  daysBetween,
  formatClock,
  formatDayMonth,
  formatDue,
  parseDay,
  plural,
} from "../format.ts";

const dayOf = (at: string) => parseDay(at.slice(0, 10));

export const dayWord = (count: number) => plural(count, "day");

export function dueText(task: Pick<TeamTask, "due_on">, asOf: string) {
  const days = daysBetween(dayOf(asOf), parseDay(task.due_on));
  return {
    due: formatDue(task.due_on),
    dueIn: days < 0 ? `overdue by ${dayWord(-days)}` : days === 0 ? "today" : `in ${dayWord(days)}`,
    overdue: days < 0,
  };
}

export const durationText = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;

const justNowMinutes = 5;

function decisionWhen(at: string, asOf: string): string {
  const then = new Date(at);
  const minutes = Math.round((new Date(asOf).getTime() - then.getTime()) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const days = daysBetween(dayOf(at), dayOf(asOf));
  if (days === 0) return `today, ${formatClock(then)}`;
  if (days === 1) return `yesterday, ${formatClock(then)}`;
  return formatDayMonth(then);
}

export function reviewerDetail(row: TeamReviewer, asOf: string): string {
  const left = row.slides_assigned - row.slides_done;
  if (row.status === "done") return `all ${row.slides_assigned} submitted`;
  if (row.status === "away") return row.away_until ? `until ${formatDue(row.away_until)}` : "";
  if (row.status === "behind") {
    return `${plural(left, "slide")} left · about ${durationText(row.minutes_left)}`;
  }
  const sinceAssigned = (new Date(asOf).getTime() - new Date(row.assigned_at).getTime()) / 60000;
  if (row.slides_done === 0 && sinceAssigned <= justNowMinutes) return "told just now";
  if (row.last_decision_at) return `last decision ${decisionWhen(row.last_decision_at, asOf)}`;
  return "not opened yet";
}

export const firstName = (name: string) => name.split(" ")[0] ?? name;

export function nudgeMessage(name: string, task: TeamTask, row: TeamReviewer, asOf: string) {
  const left = row.slides_assigned - row.slides_done;
  const verb = dueText(task, asOf).overdue ? "was" : "is";
  return `Hi ${firstName(name)}, ${task.code} ${verb} due ${formatDue(task.due_on)} and ${left} slides are left. Could you fit some in this week?`;
}

export const projectLine = (task: TeamTask) =>
  `${task.project.name} · ${task.slides} slides${task.split === "even" ? ", split evenly" : ""}`;

export function headerLine(workload: TeamWorkload): string {
  const rows = workload.open.flatMap((task) => task.reviewers);
  const behind = rows.filter((row) => row.status === "behind").length;
  const away = rows.filter((row) => row.status === "away").length;
  const overdue = workload.open.filter((task) => dueText(task, workload.as_of).overdue).length;
  return [
    plural(workload.open.length, "open task"),
    `${behind || "no"} reviewer${behind === 1 ? "" : "s"} behind`,
    ...(away ? [`${away} away`] : []),
    ...(overdue ? [`${overdue} overdue`] : []),
  ].join(" · ");
}

export const behindRows = (tasks: TeamTask[]) =>
  tasks.flatMap((task) =>
    task.reviewers
      .filter((row) => row.status === "behind" && row.nudged_at === null)
      .map((row) => ({ task, row })),
  );

export function nudgeAllQuestion(names: string[], count: number) {
  return `Nudge ${count === 1 ? andJoin(names) : `${count} people`}?`;
}

export const mostBehind = (task: TeamTask) =>
  task.reviewers.reduce<TeamReviewer | undefined>(
    (worst, row) =>
      worst === undefined ||
      row.slides_assigned - row.slides_done > worst.slides_assigned - worst.slides_done
        ? row
        : worst,
    undefined,
  );
