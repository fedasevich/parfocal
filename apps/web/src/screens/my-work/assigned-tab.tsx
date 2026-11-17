import { Trans, useLingui } from "@lingui/react/macro";
import {
  type AssignedTask,
  addTaskReviewer,
  cancelNudge,
  changeReviewTask,
  getGetReviewTaskQueryKey,
  getListTasksAssignedByMeQueryKey,
  getListTeamWorkloadQueryKey,
  nudgeReviewer,
  useGetProject,
  useGetReviewTask,
  useGetReviewTaskStates,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { DatePicker } from "@parfocal/ui/components/date-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { FormField } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { Person } from "@parfocal/ui/components/person";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { StatusTag } from "@parfocal/ui/components/tag";
import { NudgeModal } from "@parfocal/ui/components/team";
import { UndoToast } from "@parfocal/ui/components/undo-toast";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { now } from "../../clock.ts";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { formatDayMonth, formatDue, percent } from "../format.ts";
import { personProp, usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { assignedLook, assignedNudgeMessage, behindmost, changeable } from "./assigned-rows.ts";
import { SetChip, useSetLook } from "./parts.tsx";

type Modal =
  | { kind: "nudge"; task: AssignedTask; userId: string; message: string }
  | { kind: "due"; task: AssignedTask; day: string }
  | { kind: "reviewer"; task: AssignedTask; userId: string | null };

type Shown = { id: number; message: ReactNode; undo?: () => Promise<unknown> };

const isoDay = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

function useStatusLabel() {
  const { t } = useLingui();
  return (task: AssignedTask, signedOn: string | null) => {
    switch (task.status) {
      case "disagreements":
        return t`${task.open_disagreements} disagreements`;
      case "ready-to-sign-off":
        return t`Ready to sign off`;
      case "signed-off":
        return signedOn ? t`Signed off ${signedOn}` : t`Signed off`;
      case "in-review":
        return t`In review`;
      case "not-started":
        return t`Not started`;
    }
  };
}

function AssignedRow({
  task,
  selected,
  onSelect,
  onModal,
}: {
  task: AssignedTask;
  selected: boolean;
  onSelect: () => void;
  onModal: (modal: Modal) => void;
}) {
  const { t } = useLingui();

  const goTo = useGoTo();
  const people = usePeople();
  const statusLabel = useStatusLabel();
  const detail = okData(useGetReviewTask(task.id).data);
  const look = useSetLook(task.project.id);
  const setId = detail?.slides[0]?.result_set_id;
  const set = setId ? look({ id: setId, name: "" }) : undefined;
  const signed = task.status === "signed-off";
  const states = okData(useGetReviewTaskStates(task.id, { query: { enabled: signed } }).data);
  const signedOn = states?.signed_off_at ? formatDayMonth(new Date(states.signed_off_at)) : null;
  const { tone, action } = assignedLook(task);
  const behind = behindmost(task);
  const behindName = people(behind?.user_id)?.name ?? t`a reviewer`;
  const openNudge = () => {
    if (!behind) return;
    onModal({
      kind: "nudge",
      task,
      userId: behind.user_id,
      message: assignedNudgeMessage(people(behind.user_id)?.name ?? "", task, behind),
    });
  };
  return (
    <TableRow
      aria-selected={selected}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("button, a, [role='menu']"))
          return;
        onSelect();
      }}
      className="cursor-pointer"
    >
      <TableCell className="whitespace-normal">
        <b className="font-mono font-medium text-fg">{task.code}</b>{" "}
        <b className="font-medium text-fg">{task.name}</b>
        <small className="block text-caption text-fg-dim">
          {task.project.name}
          {detail ? t` · ${detail.slide_count} slides${detail.blinded ? " · blind" : ""}` : ""}
        </small>
      </TableCell>
      <TableCell className="whitespace-normal">
        {set?.label ? <SetChip label={set.label} source={set.source} /> : null}
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="grid gap-1">
          {task.reviewers.map((reviewer) => (
            <div key={reviewer.user_id} className="flex items-center gap-2 text-caption">
              <Person {...personProp(people(reviewer.user_id))} size={20} />
              <span className="min-w-0 truncate text-fg">
                {people(reviewer.user_id)?.name ?? t`Reviewer`}
              </span>
              <ProgressBar
                className="w-17.5 shrink-0"
                value={percent(reviewer.slides_submitted, reviewer.slides_assigned)}
                aria-label={t`${people(reviewer.user_id)?.name ?? "Reviewer"}, ${reviewer.slides_submitted} of ${reviewer.slides_assigned} slides`}
              />
              <span className="font-mono text-fg-dim">
                {reviewer.slides_submitted}/{reviewer.slides_assigned}
              </span>
            </div>
          ))}
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        {task.due_on ? formatDue(task.due_on) : t`No due date`}
      </TableCell>
      <TableCell className="whitespace-normal">
        <StatusTag tone={tone}>{statusLabel(task, signedOn)}</StatusTag>
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex justify-end gap-1.5">
          {action === "resolve" ? (
            <Button
              variant="primary"
              onClick={() => void goTo(destinations.disagreements(task.id))}
            >
              <Trans>Resolve</Trans>
            </Button>
          ) : null}
          {action === "sign-off" ? (
            <Button variant="primary" onClick={() => void goTo(destinations.signOff(task.id))}>
              <Trans>Sign off</Trans>
            </Button>
          ) : null}
          {action === "nudge" ? (
            <Button onClick={openNudge} title={t`Nudge ${behindName}`}>
              <Icon name="bell" />
              <Trans>Nudge</Trans>
            </Button>
          ) : null}
          {changeable(task) ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="icon" aria-label={t`More actions for ${task.code}`} title={t`More`}>
                    <Icon name="more" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                {behind ? (
                  <DropdownMenuItem
                    onClick={() =>
                      void goTo(
                        destinations.team({
                          scene: "reassign",
                          task: task.id,
                          focus: behind.user_id,
                        }),
                      )
                    }
                  >
                    <Icon name="users" />
                    <Trans>Reassign slides</Trans>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onClick={() => onModal({ kind: "due", task, day: task.due_on ?? "" })}
                >
                  <Icon name="calendar" />
                  <Trans>Change due date</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onModal({ kind: "reviewer", task, userId: null })}>
                  <Icon name="plus" />
                  <Trans>Add reviewer</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function AddReviewerModal({
  modal,
  onChange,
  onClose,
  onAdd,
}: {
  modal: Extract<Modal, { kind: "reviewer" }>;
  onChange: (userId: string | null) => void;
  onClose: () => void;
  onAdd: () => void;
}) {
  const { t } = useLingui();
  const people = usePeople();
  const project = okData(useGetProject(modal.task.project.id).data);
  const taken = new Set(modal.task.reviewers.map((reviewer) => reviewer.user_id));
  const candidates = (project?.members ?? []).filter(
    (member) =>
      (member.role === "owner" || member.role === "reviewer") && !taken.has(member.user_id),
  );
  const picked = candidates.find((member) => member.user_id === modal.userId);
  return (
    <SmallModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t`Add reviewer`}
      subtitle={`${modal.task.code} · ${modal.task.name}`}
      hint={t`They get every slide of the task and an email.`}
      primaryLabel={t`Add reviewer`}
      onPrimary={onAdd}
      blockers={
        picked
          ? []
          : [
              {
                id: "reviewer",
                text:
                  candidates.length === 0
                    ? t`Everyone who reviews in this project is on the task.`
                    : t`Pick who joins the task.`,
                goTo: t`Go to`,
              },
            ]
      }
    >
      <FormField label={t`Reviewer`}>
        <Select
          value={modal.userId ?? ""}
          onValueChange={(next) => onChange(next ? String(next) : null)}
        >
          <SelectTrigger aria-label={t`Reviewer`} className="w-full">
            <SelectValue>
              {picked ? (people(picked.user_id)?.name ?? t`Reviewer`) : t`Pick a reviewer`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            {candidates.map((member) => (
              <SelectItem key={member.user_id} value={member.user_id}>
                {people(member.user_id)?.name ?? t`Reviewer`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
    </SmallModal>
  );
}

export function AssignedTab({
  tasks,
  selected,
  onSelect,
}: {
  tasks: AssignedTask[];
  selected: string | undefined;
  onSelect: (key: string | undefined) => void;
}) {
  const { t } = useLingui();

  const goTo = useGoTo();
  const people = usePeople();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<Modal | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const firstProject = tasks[0]?.project.id;
  const nameOf = (userId: string) => people(userId)?.name ?? t`the reviewer`;

  const refresh = (taskId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListTasksAssignedByMeQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListTeamWorkloadQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetReviewTaskQueryKey(taskId) }),
    ]);

  const show = (message: ReactNode, undo?: () => Promise<unknown>) =>
    setShown({ id: Date.now(), message, ...(undo ? { undo } : {}) });

  const onSendNudge = async () => {
    if (modal?.kind !== "nudge") return;
    const { task, userId, message } = modal;
    const sent = await nudgeReviewer(task.id, { user_id: userId, message });
    setModal(null);
    await refresh(task.id);
    if (sent.status !== 201) return;
    show(t`Nudge sent to ${nameOf(userId)}`, async () => {
      await cancelNudge(task.id, sent.data.id);
      await refresh(task.id);
    });
  };

  const onChangeDue = async () => {
    if (modal?.kind !== "due" || !modal.day) return;
    const { task, day } = modal;
    const before = task.due_on;
    const changed = await changeReviewTask(task.id, { due_on: day });
    setModal(null);
    await refresh(task.id);
    if (changed.status !== 200) return;
    show(
      t`${task.code} is now due ${formatDue(day)}. Reviewers with slides left are told.`,
      async () => {
        await changeReviewTask(task.id, { due_on: before });
        await refresh(task.id);
      },
    );
  };

  const onAddReviewer = async () => {
    if (modal?.kind !== "reviewer" || !modal.userId) return;
    const { task, userId } = modal;
    const added = await addTaskReviewer(task.id, { user_id: userId });
    setModal(null);
    await refresh(task.id);
    if (added.status !== 201) return;
    show(t`${nameOf(userId)} joined ${task.code} and is told by email.`);
  };

  const nudged = modal?.kind === "nudge" ? modal : null;
  const nudgedRow = nudged?.task.reviewers.find((reviewer) => reviewer.user_id === nudged.userId);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <Button
          variant="primary"
          onClick={() =>
            firstProject ? void goTo(destinations.newReviewTask(firstProject)) : undefined
          }
        >
          <Icon name="users" />
          <Trans>New review task</Trans>
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {[t`Task`, t`Result set`, t`Reviewers`, "Due", t`Status`, ""].map((heading) => (
              <TableHead key={heading || "actions"}>{heading}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <AssignedRow
              key={task.id}
              task={task}
              selected={task.id === selected}
              onSelect={() => onSelect(task.id)}
              onModal={setModal}
            />
          ))}
        </TableBody>
      </Table>
      {tasks.length === 0 ? (
        <p className="text-body-sm text-fg-dim">
          <Trans>You have not handed out any review tasks yet. New review task starts one.</Trans>
        </p>
      ) : null}
      {nudged && nudgedRow ? (
        <NudgeModal
          open
          onOpenChange={(open) => {
            if (!open) setModal(null);
          }}
          subtitle={`${nudged.task.code} · ${nudged.task.name}`}
          person={
            people(nudged.userId) ?? {
              name: nameOf(nudged.userId),
              initials: "?",
              color: "#64748b",
            }
          }
          done={nudgedRow.slides_submitted}
          of={nudgedRow.slides_assigned}
          message={nudged.message}
          onMessageChange={(message) => setModal({ ...nudged, message })}
          onSend={() => void onSendNudge()}
        />
      ) : null}
      {modal?.kind === "due" ? (
        <SmallModal
          open
          onOpenChange={(open) => {
            if (!open) setModal(null);
          }}
          title={t`Change due date`}
          subtitle={`${modal.task.code} · ${modal.task.name}`}
          hint={t`Reviewers with slides left are told by email.`}
          primaryLabel={t`Change due date`}
          onPrimary={() => void onChangeDue()}
          blockers={
            modal.day && modal.day !== modal.task.due_on
              ? []
              : [{ id: "day", text: t`Pick a new due date.`, goTo: t`Go to` }]
          }
        >
          <FormField label={t`Due`}>
            <DatePicker
              aria-label={t`Due`}
              value={modal.day}
              min={isoDay(now())}
              today={isoDay(now())}
              onValueChange={(day) => setModal({ ...modal, day })}
            />
          </FormField>
        </SmallModal>
      ) : null}
      {modal?.kind === "reviewer" ? (
        <AddReviewerModal
          modal={modal}
          onChange={(userId) => setModal({ ...modal, userId })}
          onClose={() => setModal(null)}
          onAdd={() => void onAddReviewer()}
        />
      ) : null}
      {shown ? (
        <div className="pointer-events-none fixed inset-x-0 top-14.5 z-60 flex justify-center">
          <div className="pointer-events-auto">
            <UndoToast
              key={shown.id}
              message={shown.message}
              {...(shown.undo
                ? { onUndo: () => void shown.undo?.().then(() => setShown(null)) }
                : {})}
              onExpire={() => setShown(null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
