import {
  cancelNudge,
  getListTeamWorkloadQueryKey,
  nudgeReviewer,
  reassignSlides,
  type TeamReviewer,
  type TeamTask,
  type TeamWorkload,
  undoReassignment,
  useGetMe,
  useListAvailability,
  useListReviewerWorkload,
  useListTeamWorkload,
} from "@parfocal/api-client";
import type { PersonInfo } from "@parfocal/ui/components/person";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { TabCount, Tabs, TabsList, TabsTrigger } from "@parfocal/ui/components/tabs";
import {
  ConfirmInButton,
  DoneTaskRow,
  NudgeModal,
  ReassignModal,
  type ReassignWhat,
  ReviewerRow,
  TaskBlock,
  TeamNoMatch,
} from "@parfocal/ui/components/team";
import type { TokenItem } from "@parfocal/ui/components/token-field";
import { UndoToast } from "@parfocal/ui/components/undo-toast";
import { Zone, Zones } from "@parfocal/ui/components/zone";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { andJoin, formatDayMonth, formatDue, parseDay } from "../format.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { type TeamSearch, type TeamState, teamState } from "./scenes.ts";
import {
  behindRows,
  dueText,
  firstName,
  headerLine,
  mostBehind,
  nudgeAllQuestion,
  nudgeMessage,
  projectLine,
  reviewerDetail,
} from "./team-text.ts";

type Change = Partial<Pick<TeamState, "tab" | "project" | "reviewer">>;

type Modal =
  | { kind: "nudge"; taskId: string; userId: string; message: string }
  | {
      kind: "reassign";
      taskId: string;
      fromId: string;
      to: string | null;
      what: ReassignWhat;
      note: string;
    };

type Shown = { id: number; message: ReactNode; undo: () => Promise<unknown> };

const unknownPerson: PersonInfo = { name: "Unknown reviewer", initials: "?", color: "#64748b" };

export function TeamScreen({
  search,
  change,
  openReport,
}: {
  search: TeamSearch;
  change: (next: Change) => void;
  openReport: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const team = useListTeamWorkload().data?.data;
  const state = teamState(search, team);
  const people = usePeople();
  const me = okData(useGetMe().data)?.user_id;
  const workload = useListReviewerWorkload().data?.data ?? [];
  const availability = okData(useListAvailability().data) ?? [];
  const [modal, setModal] = useState<Modal | null>(null);
  const [asking, setAsking] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [seeded, setSeeded] = useState<string | null>(null);

  const person = (userId: string) => people(userId) ?? unknownPerson;
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListTeamWorkloadQueryKey() });
  const taskOf = (taskId: string) => team?.open.find((task) => task.id === taskId);
  const rowOf = (task: TeamTask | undefined, userId: string) =>
    task?.reviewers.find((row) => row.user_id === userId);

  const nudgeFor = (task: TeamTask, row: TeamReviewer, asOf: string): Modal => ({
    kind: "nudge",
    taskId: task.id,
    userId: row.user_id,
    message: nudgeMessage(person(row.user_id).name, task, row, asOf),
  });

  const leastLoaded = (task: TeamTask, fromId: string) =>
    [...workload]
      .filter(
        (item) =>
          item.user_id !== fromId &&
          !task.reviewers.some((row) => row.user_id === item.user_id) &&
          !availability.some((absence) => absence.user_id === item.user_id),
      )
      .sort((a, b) => a.open_tasks - b.open_tasks)[0]?.user_id ?? null;

  const sceneKey = team ? `${state.scene ?? ""}|${team.as_of}` : null;
  useEffect(() => {
    if (!team || sceneKey === seeded) return;
    setSeeded(sceneKey);
    const first = team.open.find((task) => task.id === state.task) ?? team.open[0];
    const behind = rowOf(first, state.focus ?? "") ?? (first ? mostBehind(first) : undefined);
    if (!first || !behind) return;
    if (state.scene === "nudge") setModal(nudgeFor(first, behind, team.as_of));
    if (state.scene === "reassign" || state.scene === "partial") {
      const partial = state.scene === "partial";
      setModal({
        kind: "reassign",
        taskId: first.id,
        fromId: behind.user_id,
        to: partial ? leastLoaded(first, behind.user_id) : null,
        what: partial ? "all" : "rest",
        note: "",
      });
    }
  });

  if (!team) {
    return (
      <main className="px-8 pt-5.5 pl-7">
        <p className="text-body-sm text-fg-dim">Loading Team…</p>
      </main>
    );
  }

  const show = (message: ReactNode, undo: () => Promise<unknown>) =>
    setShown({ id: Date.now(), message, undo });

  const sendNudge = async (task: TeamTask, userId: string, message: string) => {
    const sent = await nudgeReviewer(task.id, { user_id: userId, message });
    return sent.status === 201 ? sent.data : null;
  };

  const onSendNudge = async () => {
    if (modal?.kind !== "nudge") return;
    const task = taskOf(modal.taskId);
    if (!task) return;
    const sent = await sendNudge(task, modal.userId, modal.message);
    setModal(null);
    await refresh();
    if (!sent) return;
    show(`Nudge sent to ${person(modal.userId).name}`, async () => {
      await cancelNudge(task.id, sent.id);
      await refresh();
    });
  };

  const onNudgeAll = async () => {
    const list = behindRows(team.open);
    const sent = await Promise.all(
      list.map(({ task, row }) =>
        sendNudge(task, row.user_id, nudgeMessage(person(row.user_id).name, task, row, team.as_of)),
      ),
    );
    await refresh();
    const names = [...new Set(list.map(({ row }) => person(row.user_id).name))];
    show(`Nudge sent to ${andJoin(names)}`, async () => {
      await Promise.all(
        sent.flatMap((nudge) => (nudge ? [cancelNudge(nudge.task_id, nudge.id)] : [])),
      );
      await refresh();
    });
  };

  const onReassign = async () => {
    if (modal?.kind !== "reassign" || modal.to === null) return;
    const task = taskOf(modal.taskId);
    const to = modal.to;
    if (!task) return;
    const moved = await reassignSlides(task.id, {
      from_user_id: modal.fromId,
      to_user_id: to,
      what: modal.what === "all" ? "all" : "not-started",
      note: modal.note.trim() || null,
    });
    setModal(null);
    await refresh();
    if (moved.status !== 201) return;
    show(
      `${moved.data.slides_moved} slides of ${task.code} moved to ${person(to).name}. Both are told by email.`,
      async () => {
        await undoReassignment(task.id, moved.data.id);
        await refresh();
      },
    );
  };

  const pool = state.tab === "done" ? team.done : team.open;
  const projects = [...new Map(pool.map((task) => [task.project.id, task.project])).values()];
  const reviewerIds = [
    ...new Set(pool.flatMap((task) => task.reviewers.map((row) => row.user_id))),
  ];
  const matches = (task: TeamTask) =>
    (!state.project || task.project.id === state.project) &&
    (!state.reviewer || task.reviewers.some((row) => row.user_id === state.reviewer));
  const shownTasks = pool.filter(matches);
  const filtered = Boolean(state.project || state.reviewer);
  const clear = () => change({ project: undefined, reviewer: undefined });

  const behind = behindRows(team.open);
  const behindNames = [...new Set(behind.map(({ row }) => firstName(person(row.user_id).name)))];
  const anyBehind = team.open.some((task) => task.reviewers.some((row) => row.status === "behind"));

  const modalTask = modal ? taskOf(modal.taskId) : undefined;
  const modalRow = modal
    ? rowOf(modalTask, modal.kind === "nudge" ? modal.userId : modal.fromId)
    : undefined;

  const candidates: TokenItem[] =
    modal?.kind === "reassign" && modalTask
      ? workload.map((item) => {
          const info = person(item.user_id);
          const absence = availability.find((entry) => entry.user_id === item.user_id);
          const dim =
            item.user_id === modal.fromId
              ? "Has these slides now"
              : modalTask.reviewers.some((row) => row.user_id === item.user_id)
                ? "Reviews this task"
                : undefined;
          return {
            id: item.user_id,
            name: info.name,
            person: info,
            ...(info.role ? { sub: info.role } : {}),
            ...(dim ? { dim } : {}),
            ...(absence?.until && !dim
              ? {
                  end: `Away until ${formatDayMonth(parseDay(absence.until))}`,
                  endTone: "warn" as const,
                }
              : {}),
          };
        })
      : [];
  const pickedAbsence =
    modal?.kind === "reassign" && modal.to
      ? availability.find((entry) => entry.user_id === modal.to)
      : undefined;

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 px-8 pt-5.5 pb-4.5 pl-7">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[24px] font-semibold tracking-[-0.01em] text-fg">Team</h1>
          <p className="mt-0.75 mb-0 text-body-sm leading-[1.45] text-fg-dim">
            Who is reviewing what · {headerLine(team)}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {state.tab === "open" ? (
            <ConfirmInButton
              label="Nudge all behind"
              question={nudgeAllQuestion(behindNames, behind.length)}
              confirm="Yes, nudge"
              asking={asking}
              onAskingChange={setAsking}
              onConfirm={() => void onNudgeAll()}
              disabled={behind.length === 0}
              title={
                behind.length
                  ? `Nudges ${andJoin(behindNames)}`
                  : anyBehind
                    ? "Everyone behind was nudged"
                    : "Nobody is behind right now"
              }
            />
          ) : null}
        </div>
      </header>
      <Tabs
        value={state.tab}
        onValueChange={(value) => {
          setAsking(false);
          change({ tab: value as TeamState["tab"], project: undefined, reviewer: undefined });
        }}
      >
        <TabsList variant="page">
          <TabsTrigger value="open">
            Open tasks<TabCount>{team.open.length}</TabCount>
          </TabsTrigger>
          <TabsTrigger value="done">
            Done<TabCount>{team.done.length}</TabCount>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex items-center gap-2">
        <FilterSelect
          label="Project"
          value={state.project}
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          onChange={(project) => change({ project })}
        />
        <FilterSelect
          label="Reviewer"
          value={state.reviewer}
          options={reviewerIds.map((userId) => ({ value: userId, label: person(userId).name }))}
          onChange={(reviewer) => change({ reviewer })}
        />
        {filtered ? (
          <button
            type="button"
            onClick={clear}
            className="ml-1.5 cursor-pointer border-0 bg-transparent p-0 text-body-sm font-medium text-accent hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </div>
      <Zones className="min-h-0 flex-1 overflow-auto pb-2">
        {shownTasks.length === 0 ? (
          <TeamNoMatch onClear={clear}>
            No {state.tab === "done" ? "signed-off" : "open"} task matches these filters.
          </TeamNoMatch>
        ) : state.tab === "done" ? (
          <Zone title="Signed off">
            {shownTasks.map((task) => (
              <DoneTaskRow
                key={task.id}
                code={task.code}
                title={task.name}
                project={task.project.name}
                people={task.reviewers.map((row) => person(row.user_id))}
                signedOn={task.signed_on ? formatDayMonth(parseDay(task.signed_on)) : ""}
                onOpenReport={() => openReport(task.id)}
              />
            ))}
          </Zone>
        ) : (
          shownTasks.map((task) => (
            <OpenTask
              key={task.id}
              task={task}
              team={team}
              state={state}
              me={me}
              person={person}
              onNudge={(row) => setModal(nudgeFor(task, row, team.as_of))}
              onReassign={(row) =>
                setModal({
                  kind: "reassign",
                  taskId: task.id,
                  fromId: row.user_id,
                  to: null,
                  what: "rest",
                  note: "",
                })
              }
            />
          ))
        )}
      </Zones>
      {modal?.kind === "nudge" && modalTask && modalRow ? (
        <NudgeModal
          open
          onOpenChange={(open) => {
            if (!open) setModal(null);
          }}
          subtitle={`${modalTask.code} · ${modalTask.name}`}
          person={person(modalRow.user_id)}
          done={modalRow.slides_done}
          of={modalRow.slides_assigned}
          message={modal.message}
          onMessageChange={(message) => setModal({ ...modal, message })}
          onSend={() => void onSendNudge()}
        />
      ) : null}
      {modal?.kind === "reassign" && modalTask && modalRow ? (
        <ReassignModal
          open
          onOpenChange={(open) => {
            if (!open) setModal(null);
          }}
          subtitle={`${modalTask.code} · ${modalTask.name}`}
          from={person(modalRow.user_id)}
          done={modalRow.slides_done}
          of={modalRow.slides_assigned}
          candidates={candidates}
          to={modal.to}
          onToChange={(to) => setModal({ ...modal, to })}
          toWarning={
            modal.to && pickedAbsence?.until
              ? `${person(modal.to).name} is away until ${formatDayMonth(parseDay(pickedAbsence.until))}. The slides wait until then.`
              : undefined
          }
          what={modal.what}
          onWhatChange={(what) => setModal({ ...modal, what })}
          note={modal.note}
          onNoteChange={(note) => setModal({ ...modal, note })}
          onReassign={() => void onReassign()}
        />
      ) : null}
      {shown ? (
        <div className="pointer-events-none fixed inset-x-0 top-14.5 z-60 flex justify-center">
          <div className="pointer-events-auto">
            <UndoToast
              key={shown.id}
              message={shown.message}
              onUndo={() => void shown.undo()}
              onExpire={() => setShown(null)}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function OpenTask({
  task,
  team,
  state,
  me,
  person,
  onNudge,
  onReassign,
}: {
  task: TeamTask;
  team: TeamWorkload;
  state: TeamState;
  me: string | undefined;
  person: (userId: string) => PersonInfo;
  onNudge: (row: TeamReviewer) => void;
  onReassign: (row: TeamReviewer) => void;
}) {
  const due = dueText(task, team.as_of);
  const rows = task.reviewers.filter((row) => !state.reviewer || row.user_id === state.reviewer);
  return (
    <TaskBlock
      code={task.code}
      title={task.name}
      project={projectLine(task)}
      due={due.due}
      dueIn={due.dueIn}
      overdue={due.overdue}
      highlight={state.task === task.id}
      aria-label={`${task.code} · ${task.name}`}
    >
      {rows.map((row) => {
        const info = person(row.user_id);
        return (
          <ReviewerRow
            key={row.user_id}
            person={info}
            done={row.slides_done}
            of={row.slides_assigned}
            last={reviewerDetail(row, team.as_of)}
            status={row.status}
            awayUntil={row.away_until ? formatDue(row.away_until) : undefined}
            you={row.user_id === me}
            nudged={row.nudged_at !== null}
            highlight={state.task === task.id && state.focus === row.user_id}
            hint={
              row.status === "away"
                ? `${task.code} waits for ${firstName(info.name)}. Reassign if it cannot.`
                : undefined
            }
            onNudge={() => onNudge(row)}
            onReassign={() => onReassign(row)}
          />
        );
      })}
    </TaskBlock>
  );
}

const allValue = "all";

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <Select
      value={value ?? allValue}
      onValueChange={(next) =>
        onChange(next === allValue || next === null ? undefined : String(next))
      }
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue>
          {label}: {current?.label ?? "all"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        <SelectItem value={allValue}>all</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
