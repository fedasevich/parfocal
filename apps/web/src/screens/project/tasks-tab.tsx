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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { okData } from "../placeholder.tsx";
import { reviewerProgress, taskStatus } from "./model.ts";
import { usePeople } from "./people.ts";
import { TaskSettingsDrawer } from "./task-settings-drawer.tsx";

const dueText = (iso: string | null) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "No due date";

const headCell = "px-4 py-(--density-head-y)";

export function TasksTab({
  project,
  tasks,
  toast,
}: {
  project: Project;
  tasks: ReviewTask[];
  toast: (message: ReactNode) => void;
}) {
  const [settingsOf, setSettingsOf] = useState<string | null>(null);
  const opened = tasks.find((task) => task.id === settingsOf);
  return (
    <>
      <div className="flex-none overflow-auto rounded-zone border border-line bg-surf-panel">
        <Table containerClassName="overflow-visible">
          <TableHeader>
            <TableRow>
              <TableHead className={headCell}>Task</TableHead>
              <TableHead className={headCell}>Reviewers</TableHead>
              <TableHead className={headCell}>Due</TableHead>
              <TableHead className={headCell}>Status</TableHead>
              <TableHead className={headCell}>
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                project={project}
                task={task}
                onSettings={() => setSettingsOf(task.id)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      {opened ? (
        <TaskSettingsDrawer task={opened} onClose={() => setSettingsOf(null)} toast={toast} />
      ) : null}
    </>
  );
}

function TaskRow({
  project,
  task,
  onSettings,
}: {
  project: Project;
  task: ReviewTask;
  onSettings: () => void;
}) {
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
    <TableRow
      data-testid="task-row"
      className="[&>td]:px-4 [&>td]:py-(--density-list-row-y) [&>td]:whitespace-normal"
    >
      <TableCell>
        <span className="grid min-w-0 gap-0.5">
          <b className="font-semibold text-fg">
            <span className="font-mono">{task.code}</span> · {task.name}
          </b>
          <small className="max-w-85 truncate text-caption text-fg-faint">
            {facts.join(" · ")}
          </small>
        </span>
      </TableCell>
      <TableCell>
        <div className="grid gap-2">
          {progress.length > 0 ? (
            progress.map((row) => (
              <div
                key={row.userId}
                className="grid grid-cols-[150px_120px_auto] items-center gap-3 text-caption"
              >
                <Person person={people.byId(row.userId)} size={22} />
                <ProgressBar
                  value={(100 * row.done) / Math.max(row.total, 1)}
                  aria-label={`${people.byId(row.userId).name}, ${row.done} of ${row.total} slides`}
                />
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
      </TableCell>
      <TableCell>{dueText(task.due_on)}</TableCell>
      <TableCell>
        <StatusTag tone={status.tone}>{status.label}</StatusTag>
      </TableCell>
      <TableCell className="w-px text-right whitespace-nowrap">
        <span className="inline-flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Settings for ${task.code}`}
            title="Task settings"
            onClick={onSettings}
          >
            <Icon name="gear" />
          </Button>
          {status.label === "Signed off" ? null : status.label === "Ready to sign off" ? (
            <Button
              size="sm"
              variant="primary"
              nativeButton={false}
              render={<Link to="/tasks/$taskId/sign-off" params={{ taskId: task.id }} />}
            >
              Sign off
            </Button>
          ) : (
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
        </span>
      </TableCell>
    </TableRow>
  );
}
