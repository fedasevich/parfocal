import {
  type Project,
  type ReviewTask,
  useGetReviewTask,
  useGetReviewTaskStates,
  useListProjectResultSets,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Person } from "@parfocal/ui/components/person";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Link } from "@tanstack/react-router";
import { okData } from "../placeholder.tsx";
import { reviewerProgress, taskStatus } from "./model.ts";
import { usePeople } from "./people.ts";

const dueText = (iso: string | null) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "No due date";

export function TasksTab({ project, tasks }: { project: Project; tasks: ReviewTask[] }) {
  return (
    <div className="flex-none overflow-auto rounded-zone border border-line bg-surf-panel">
      <table className="w-full border-collapse text-body-sm">
        <thead>
          <tr className="[&>th]:border-b [&>th]:border-line [&>th]:bg-surf-panel [&>th]:px-4 [&>th]:py-2.75 [&>th]:text-left [&>th]:text-caption [&>th]:font-semibold [&>th]:text-fg-dim">
            <th>Task</th>
            <th>Reviewers</th>
            <th>Due</th>
            <th>Status</th>
            <th>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <TaskRow key={task.id} project={project} task={task} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({ project, task }: { project: Project; task: ReviewTask }) {
  const states = okData(useGetReviewTaskStates(task.id).data);
  const detail = okData(useGetReviewTask(task.id).data);
  const sets = okData(useListProjectResultSets(project.id).data) ?? [];
  const people = usePeople();
  const progress = reviewerProgress(states);
  const status = taskStatus(states, progress);
  const set = sets.find((candidate) => candidate.id === detail?.slides[0]?.result_set_id);
  const facts = [
    set ? `${set.name.split(" ")[0]} ${set.model_version}` : null,
    `${task.slide_count} slides${task.split === "even" ? ", split evenly" : ""}`,
    task.blinded ? "blind" : null,
  ].filter(Boolean);
  const behind = [...progress].sort((a, b) => b.total - b.done - (a.total - a.done))[0];
  return (
    <tr
      data-testid="task-row"
      className="[&>td]:border-b [&>td]:border-line [&>td]:px-4 [&>td]:py-3 [&>td]:text-fg-dim last:[&>td]:border-b-0"
    >
      <td>
        <span className="grid min-w-0 gap-0.5">
          <b className="font-semibold text-fg">
            <span className="font-mono">{task.code}</span> · {task.name}
          </b>
          <small className="max-w-85 truncate text-caption text-fg-faint">
            {facts.join(" · ")}
          </small>
        </span>
      </td>
      <td>
        <div className="grid gap-2">
          {progress.length > 0 ? (
            progress.map((row) => (
              <div
                key={row.userId}
                className="grid grid-cols-[150px_120px_auto] items-center gap-3 text-caption"
              >
                <Person person={people.byId(row.userId)} size={22} />
                <ProgressBar value={(100 * row.done) / Math.max(row.total, 1)} />
                <span className="font-mono">
                  {row.done} of {row.total}
                </span>
              </div>
            ))
          ) : (
            <span>
              {task.reviewer_count} reviewer{task.reviewer_count === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </td>
      <td>{dueText(task.due_on)}</td>
      <td>
        <StatusTag tone={status.tone}>{status.label}</StatusTag>
      </td>
      <td className="w-px text-right whitespace-nowrap">
        {status.label === "Signed off" ? null : (
          <Button
            size="sm"
            title={behind ? `Nudge ${people.byId(behind.userId).name}` : "Nudge"}
            nativeButton={false}
            render={<Link to="/team" search={{ scene: "nudge" }} />}
          >
            <Icon name="bell" />
            Nudge
          </Button>
        )}
      </td>
    </tr>
  );
}
