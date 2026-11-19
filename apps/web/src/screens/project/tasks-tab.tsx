import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
import { SkeletonRows } from "@parfocal/ui/components/skeleton";
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
import { formatDue, plural } from "../format.ts";
import { okData } from "../placeholder.tsx";
import { TaskViewerLinks } from "../viewer-links.tsx";
import { reviewerProgress, taskStatus } from "./model.ts";
import { usePeople } from "./people.ts";
import { TaskSettingsDrawer } from "./task-settings-drawer.tsx";

const dueText = (iso: string | null) => (iso ? formatDue(iso) : t`No due date`);

const headCell = "px-4 py-(--density-head-y)";

export function TasksTab({
  project,
  tasks,
  loading = false,
  toast,
}: {
  project: Project;
  tasks: ReviewTask[];
  loading?: boolean;
  toast: (message: ReactNode) => void;
}) {
  const { t } = useLingui();
  const [settingsOf, setSettingsOf] = useState<string | null>(null);
  const opened = tasks.find((task) => task.id === settingsOf);
  return (
    <>
      <div className="flex-none overflow-auto rounded-zone border border-line bg-surf-panel">
        <Table containerClassName="overflow-visible">
          <TableHeader>
            <TableRow>
              <TableHead className={headCell}>
                <Trans>Task</Trans>
              </TableHead>
              <TableHead className={headCell}>
                <Trans>Reviewers</Trans>
              </TableHead>
              <TableHead className={headCell}>
                <Trans>Due</Trans>
              </TableHead>
              <TableHead className={headCell}>
                <Trans>Status</Trans>
              </TableHead>
              <TableHead className={headCell}>
                <span className="sr-only">
                  <Trans>Action</Trans>
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="p-0">
                  <SkeletonRows label={t`Loading tasks`} rows={4} columns={5} />
                </TableCell>
              </TableRow>
            ) : null}
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
  const { t } = useLingui();

  const states = okData(useGetReviewTaskStates(task.id).data);
  const detail = okData(useGetReviewTask(task.id).data);
  const sets = okData(useListProjectResultSets(project.id).data) ?? [];
  const people = usePeople();
  const progress = reviewerProgress(states);
  const status = taskStatus(states, progress);
  const set = sets.find((candidate) => candidate.id === detail?.slides[0]?.result_set_id);
  const facts = [
    set ? `${set.name.split(" ")[0]} ${set.model_version}` : null,
    `${plural(task.slide_count, "slide")}${task.split === "even" ? t`, split evenly` : ""}`,
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
          <span className="-ml-2">
            <TaskViewerLinks taskId={task.id} projectId={project.id} />
          </span>
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
                  aria-label={t`${people.byId(row.userId).name}, ${row.done} of ${row.total} slides`}
                />
                <span className="font-mono">
                  <Trans>
                    {row.done} of {row.total}
                  </Trans>
                </span>
              </div>
            ))
          ) : (
            <span>
              <Trans>{task.reviewer_count} reviewer</Trans>
              {task.reviewer_count === 1 ? "" : t`s`}
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
            aria-label={t`Settings for ${task.code}`}
            title={t`Task settings`}
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
              <Trans>Sign off</Trans>
            </Button>
          ) : (
            <Button
              size="sm"
              title={behind ? t`Nudge ${people.byId(behind.userId).name}` : t`Nudge`}
              nativeButton={false}
              render={<Link to="/team" search={{ scene: "nudge" }} />}
            >
              <Icon name="bell" />
              <Trans>Nudge</Trans>
            </Button>
          )}
        </span>
      </TableCell>
    </TableRow>
  );
}
