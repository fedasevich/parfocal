import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  getGetDisagreementQueueQueryKey,
  type QueueRow,
  useGetDisagreementQueue,
  useGetProject,
  useGetReviewTask,
  useGetSignOffSummary,
  useListProjectClasses,
  useNudgeReviewer,
  useSendToAdjudicator,
  useUpdateQueuedObject,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { KeyValueList } from "@parfocal/ui/components/connect-model";
import type { ProjectClass } from "@parfocal/ui/components/decision-buttons";
import { DecisionButtons } from "@parfocal/ui/components/decision-buttons";
import {
  EvidenceList,
  EvidenceRow,
  QueueRow as QueueRowView,
  QueueTable,
  QuotedNote,
} from "@parfocal/ui/components/disagreements";
import { Breadcrumbs } from "@parfocal/ui/components/flow-page";
import { Icon } from "@parfocal/ui/components/icon";
import { Person } from "@parfocal/ui/components/person";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { ObjectIdTag, StatusTag } from "@parfocal/ui/components/tag";
import { NudgeModal } from "@parfocal/ui/components/team";
import { Textarea } from "@parfocal/ui/components/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { useRouterLink } from "../../shell/router-link.tsx";
import { personProp, usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { useScreenToast } from "../project/screen-toast.tsx";
import { type ReviewStyle, toReviewStyle } from "../review/decision-mapping.ts";
import { answersOf } from "../review/decision-style.ts";
import { fromMentionTokens } from "../review/mention-picking.ts";
import { ViewerLink } from "../viewer-links.tsx";
import { DisagreementStage } from "./disagreement-stage.tsx";
import { SendToAdjudicatorModal } from "./send-modal.tsx";
import {
  allClosed,
  answerTone,
  canSend,
  claimText,
  countOf,
  filterCounts,
  filterRows,
  isClosed,
  nextOpen,
  type QueueFilter,
  rowLabel,
  rowTag,
  styledText,
  styledWord,
} from "./text.ts";

type SendDraft = { keys: string[]; excluded: string[] };

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function QueueScreen({ taskId }: { taskId: string }) {
  const { t } = useLingui();

  const queue = okData(useGetDisagreementQueue(taskId).data);
  const summary = okData(useGetSignOffSummary(taskId).data);
  const task = okData(useGetReviewTask(taskId).data);
  const project = okData(
    useGetProject(task?.project_id ?? "", { query: { enabled: Boolean(task) } }).data,
  );
  const classList = okData(
    useListProjectClasses(task?.project_id ?? "", { query: { enabled: Boolean(task) } }).data,
  );
  const style = toReviewStyle(task?.decision);
  const classes = (classList ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    color: item.colour,
  }));
  const look = { style, classes };
  const person = usePeople();
  const nameOf = (userId: string | null | undefined) => person(userId)?.name;
  const renderLink = useRouterLink();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useScreenToast();
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [send, setSend] = useState<SendDraft | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [nudging, setNudging] = useState<{ userId: string; message: string } | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetDisagreementQueueQueryKey(taskId) });
  const update = useUpdateQueuedObject({ mutation: { onSuccess: () => void refresh() } });
  const sendTo = useSendToAdjudicator({ mutation: { onSuccess: () => void refresh() } });
  const nudge = useNudgeReviewer();
  const rows = queue?.rows ?? [];
  const row =
    rows.find((candidate) => candidate.key === selectedKey) ??
    rows.find((candidate) => !isClosed(candidate)) ??
    rows[0];
  const locked = queue?.locked ?? null;
  const reviewerIds = [...new Set(rows.flatMap((item) => item.answers.map((a) => a.user_id)))];
  const taskCode = task?.code ?? "RT-14";

  const select = (key: string) => setSelectedKey(key);

  const decide = (target: QueueRow, raw: string) => {
    const note = notes[target.key]?.trim() || null;
    update.mutate({
      taskId,
      slideId: target.slide_id,
      objectId: target.object,
      data: {
        action: "decide",
        raw,
        counts_as: countOf(style, raw, target.ai.class_name),
        note,
      },
    });
    const next = nextOpen(rows, target);
    if (next) select(next.key);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (send || nudging || locked || !row || checked.length > 0) return;
      if (row.state === "with-adjudicator" || row.state === "adjudicated") return;
      const raw = answersOf(style, classes, { class_name: row.ai.class_name }).find(
        (item) => item.key.toLowerCase() === event.key.toLowerCase(),
      )?.raw;
      if (raw !== undefined) {
        event.preventDefault();
        decide(row, raw);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const counts = filterCounts(rows);
  const shown = filterRows(rows, filter);
  const resolved = rows.filter((item) =>
    ["decided", "left-open", "adjudicated"].includes(item.state),
  ).length;
  const withAdjudicator = rows.filter((item) => item.state === "with-adjudicator").length;
  const everyClosed = allClosed(rows);
  const lockedName = nameOf(locked?.user_id) ?? "A reviewer";
  const sub = locked
    ? locked.slides_left === 1
      ? t`The queue opens when every reviewer has submitted. ${lockedName} has 1 slide left.`
      : t`The queue opens when every reviewer has submitted. ${lockedName} has ${locked.slides_left} slides left.`
    : t`${task?.name ?? ""} · ${plural(rows.length - resolved, { one: "# object needs", other: "# objects need" })} a decision out of ${queue?.total_objects ?? 0} · ${resolved} resolved${withAdjudicator ? t` · ${withAdjudicator} with the adjudicator` : ""}`;
  const checkedRows = rows.filter((item) => checked.includes(item.key));

  const sendObjects = (keys: string[], adjudicatorId: string, note: string | null) => {
    const picked = rows.filter((item) => keys.includes(item.key));
    sendTo.mutate(
      {
        taskId,
        data: {
          adjudicator_user_id: adjudicatorId,
          note,
          objects: picked.map((item) => ({ slide_id: item.slide_id, object: item.object })),
        },
      },
      {
        onSuccess: () =>
          toast.show(
            t`${picked.length} object${picked.length === 1 ? "" : "s"} sent to ${nameOf(adjudicatorId) ?? "the adjudicator"}`,
          ),
      },
    );
    setChecked([]);
    setSend(null);
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-(--density-flow-gap) overflow-auto px-7 pt-5 pb-5">
      <header className="flex items-end justify-between gap-4">
        <div className="grid gap-1">
          <Breadcrumbs
            renderLink={renderLink}
            items={[
              { label: t`My work`, href: destinations.myWork() },
              {
                label: project?.name ?? t`Project`,
                ...(task ? { href: destinations.project(task.project_id) } : {}),
              },
              {
                label: `${taskCode} · ${task?.name.split(" · ")[0] ?? ""}`,
                ...(task ? { href: `${destinations.project(task.project_id)}?tab=tasks` } : {}),
              },
              { label: t`Disagreements` },
            ]}
          />
          <h1 className="m-0 text-page-title font-semibold tracking-[-0.01em] text-fg">
            <Trans>Disagreements in {taskCode}</Trans>
          </h1>
          <p className="m-0 flex items-center gap-1.5 text-body-sm text-fg-dim">
            {locked ? <Icon name="lock" /> : null}
            {sub}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {locked ? (
            <Button
              variant="primary"
              onClick={() =>
                setNudging({
                  userId: locked.user_id,
                  message: t`Hi ${lockedName.split(" ")[0]}, ${taskCode} is waiting on your last ${locked.slides_left} slides before its disagreements can be decided. Could you fit them in this week?`,
                })
              }
            >
              <Icon name="bell" />
              <Trans>Nudge {lockedName.split(" ")[0]}</Trans>
            </Button>
          ) : (
            <Button
              variant={everyClosed ? "primary" : "default"}
              title={
                everyClosed
                  ? t`Every object is decided, left open or with the adjudicator`
                  : t`Sign-off lists what is still open`
              }
              onClick={() => void navigate({ to: "/tasks/$taskId/sign-off", params: { taskId } })}
            >
              <Trans>Go to sign-off</Trans>
            </Button>
          )}
        </div>
      </header>
      <div className="grid min-h-0 grid-cols-[320px_minmax(0,1fr)_minmax(300px,300px)] items-start gap-5">
        <section aria-label={t`Queued objects`} className="grid gap-1">
          <SegmentedControl
            aria-label={t`Show`}
            className="mb-2"
            value={filter}
            disabled={Boolean(locked)}
            onValueChange={(value) => setFilter(value as QueueFilter)}
            options={[
              { value: "all", label: `All ${counts.all}` },
              { value: "rev", label: t`Reviewers differ ${counts.rev}` },
              { value: "ai", label: t`Both vs AI ${counts.ai}` },
            ]}
          />
          <QueueTable aria-label={t`Queued objects`}>
            {shown.map((item) => {
              const tag = rowTag(item, nameOf, look);
              return (
                <QueueRowView
                  key={item.key}
                  object={item.object}
                  slide={item.slide_label}
                  tag={tag.label}
                  tone={tag.tone}
                  locked={Boolean(locked)}
                  selected={!locked && item.key === row?.key}
                  done={isClosed(item)}
                  checkable={canSend(item)}
                  checked={checked.includes(item.key)}
                  onSelect={() => select(item.key)}
                  viewerLink={
                    task ? (
                      <ViewerLink
                        target={{
                          projectId: task.project_id,
                          slideId: item.slide_id,
                          taskId,
                          object: item.object,
                        }}
                        label={t`Open ${item.object} in the full viewer`}
                      />
                    ) : null
                  }
                  onCheckedChange={(on) =>
                    setChecked((now) =>
                      on ? [...now, item.key] : now.filter((key) => key !== item.key),
                    )
                  }
                />
              );
            })}
          </QueueTable>
        </section>
        {locked ? (
          <section className="col-span-2 grid min-h-60 place-items-center rounded-zone bg-surf-panel p-8 text-center">
            <div className="grid justify-items-center gap-2 text-body-sm text-fg-dim">
              <Icon name="lock" size="md" />
              <b className="text-fg">
                <Trans>Nothing to decide yet</Trans>
              </b>
              <span>
                <Trans>Decisions open here once both reviews are in.</Trans>
              </span>
            </div>
          </section>
        ) : row ? (
          <>
            <section aria-label={t`Evidence for ${rowLabel(row)}`} className="grid gap-3">
              <div className="relative flex h-[360px] overflow-hidden rounded-zone bg-canvas">
                <DisagreementStage
                  taskId={taskId}
                  slideId={row.slide_id}
                  object={row.object}
                  className="h-full"
                />
              </div>
              <EvidenceList>
                <EvidenceRow
                  icon="smart"
                  title={summary?.result_set.name ? t`AI · ${summary.result_set.name}` : t`AI`}
                >
                  {claimText(row.ai)}
                </EvidenceRow>
                {row.answers.map((answer) => (
                  <EvidenceRow
                    key={answer.user_id}
                    title={<Person {...personProp(person(answer.user_id))} size={20} />}
                  >
                    {row.state === "look-again" ? (
                      <StatusTag tone="accent">
                        <Trans>open again</Trans>
                      </StatusTag>
                    ) : (
                      <>
                        <StatusTag tone={answerTone[countOf(style, answer.raw, row.ai.class_name)]}>
                          {styledText(style, answer, classes, row.ai.class_name)}
                        </StatusTag>
                        {answer.note ? (
                          <QuotedNote>
                            {fromMentionTokens(answer.note, (userId) => person(userId)?.name)}
                          </QuotedNote>
                        ) : null}
                      </>
                    )}
                  </EvidenceRow>
                ))}
                <EvidenceRow icon="check" title={t`Decision`}>
                  {row.decision ? (
                    <>
                      <StatusTag
                        tone={answerTone[countOf(style, row.decision.raw, row.ai.class_name)]}
                      >
                        {styledWord(style, row.decision.raw, classes, row.ai.class_name)}
                      </StatusTag>
                      {row.state === "adjudicated" ? (
                        <small className="text-caption text-fg-dim">
                          <Trans>{nameOf(row.decision.by_user_id)}, adjudicator</Trans>
                        </small>
                      ) : row.decision.note ? (
                        <QuotedNote>{row.decision.note}</QuotedNote>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-fg-dim">
                      <Trans>Not decided yet</Trans>
                    </span>
                  )}
                </EvidenceRow>
              </EvidenceList>
            </section>
            <aside aria-label={t`Decide`} className="rounded-zone bg-surf-panel p-4">
              {checkedRows.length > 0 ? (
                <div className="grid gap-3">
                  <div className="flex items-center justify-between">
                    <b className="text-body font-semibold">
                      {plural(checkedRows.length, {
                        one: "# object selected",
                        other: "# objects selected",
                      })}
                    </b>
                    <Button size="sm" variant="ghost" onClick={() => setChecked([])}>
                      <Trans>Clear</Trans>
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {checkedRows.map((item) => (
                      <ObjectIdTag key={item.key}>{rowLabel(item)}</ObjectIdTag>
                    ))}
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => setSend({ keys: checked, excluded: reviewerIds })}
                  >
                    <Icon name="user" />
                    <Trans>Send to an adjudicator</Trans>
                  </Button>
                  <p className="m-0 text-body-sm text-fg-dim">
                    <Trans>
                      The reviewers of {taskCode} cannot be picked. The adjudicator sees them as
                      Reviewer A and Reviewer B.
                    </Trans>
                  </p>
                </div>
              ) : (
                <DecidePanel
                  row={row}
                  rows={rows}
                  look={look}
                  note={notes[row.key] ?? row.decision?.note ?? ""}
                  nameOf={nameOf}
                  person={person}
                  onNote={(text) => setNotes((now) => ({ ...now, [row.key]: text }))}
                  onDecide={(raw) => decide(row, raw)}
                  onLeaveOpen={() => {
                    update.mutate({
                      taskId,
                      slideId: row.slide_id,
                      objectId: row.object,
                      data: { action: "leave-open", note: notes[row.key]?.trim() || null },
                    });
                    toast.show(t`${rowLabel(row)} is left open. Sign-off counts it on purpose.`);
                  }}
                  onSend={(keys, excluded) => setSend({ keys, excluded })}
                  onEdit={() =>
                    void navigate({
                      href: destinations.slide(
                        task?.project_id ?? "",
                        row.slide_id,
                        taskId,
                        row.object,
                      ),
                    })
                  }
                  onLookAgain={() => {
                    update.mutate({
                      taskId,
                      slideId: row.slide_id,
                      objectId: row.object,
                      data: { action: "look-again" },
                    });
                    toast.show(t`Both reviewers have ${row.object} open again`);
                  }}
                  onKeep={() =>
                    update.mutate({
                      taskId,
                      slideId: row.slide_id,
                      objectId: row.object,
                      data: { action: "keep-decisions" },
                    })
                  }
                  reviewerIds={reviewerIds}
                />
              )}
            </aside>
          </>
        ) : null}
      </div>
      {send ? (
        <SendToAdjudicatorModal
          labels={rows.filter((item) => send.keys.includes(item.key)).map(rowLabel)}
          taskCode={taskCode}
          excluded={[...reviewerIds, ...send.excluded]}
          onClose={() => setSend(null)}
          onSend={(adjudicatorId, note) => sendObjects(send.keys, adjudicatorId, note)}
        />
      ) : null}
      {nudging && person(nudging.userId) ? (
        <NudgeModal
          open
          onOpenChange={(open) => {
            if (!open) setNudging(null);
          }}
          subtitle={`${taskCode} · ${task?.name ?? ""}`}
          person={person(nudging.userId) ?? { name: "", initials: "", color: "" }}
          done={(task?.slide_count ?? 12) - (locked?.slides_left ?? 0)}
          of={task?.slide_count ?? 12}
          message={nudging.message}
          onMessageChange={(message) => setNudging({ ...nudging, message })}
          onSend={() => {
            nudge.mutate({
              taskId,
              data: { user_id: nudging.userId, message: nudging.message },
            });
            setNudging(null);
            toast.show(t`Nudge sent to ${nameOf(nudging.userId) ?? "the reviewer"}`);
          }}
        />
      ) : null}
      {toast.node}
    </main>
  );
}

type DecidePanelProps = {
  row: QueueRow;
  rows: QueueRow[];
  look: { style: ReviewStyle; classes: ProjectClass[] };
  note: string;
  reviewerIds: string[];
  nameOf: (userId: string | null | undefined) => string | undefined;
  person: ReturnType<typeof usePeople>;
  onNote: (text: string) => void;
  onDecide: (raw: string) => void;
  onLeaveOpen: () => void;
  onSend: (keys: string[], excluded: string[]) => void;
  onEdit: () => void;
  onLookAgain: () => void;
  onKeep: () => void;
};

const linkClass =
  "inline-flex min-h-6 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-body-sm text-accent hover:underline";

function DecidePanel({
  row,
  rows,
  look,
  note,
  reviewerIds,
  nameOf,
  person,
  onNote,
  onDecide,
  onLeaveOpen,
  onSend,
  onEdit,
  onLookAgain,
  onKeep,
}: DecidePanelProps) {
  const { t } = useLingui();

  const tag = rowTag(row, nameOf, look);
  const label = rowLabel(row);
  const head = (
    <div className="flex items-center justify-between gap-2">
      <b className="flex items-center gap-2 text-body font-semibold">
        <Trans>Decide</Trans> <ObjectIdTag>{label}</ObjectIdTag>
      </b>
      <StatusTag tone={tag.tone}>{tag.label}</StatusTag>
    </div>
  );
  if (row.state === "look-again") {
    return (
      <div className="grid gap-3">
        {head}
        <p className="m-0 text-body-sm text-fg-dim">
          <Trans>
            Both reviewers have {row.object} open again with your note. It comes back here when they
            decide.
          </Trans>
        </p>
      </div>
    );
  }
  if (row.state === "with-adjudicator") {
    return (
      <div className="grid gap-3">
        {head}
        <p className="m-0 text-body-sm text-fg-dim">
          <Trans>
            {nameOf(row.adjudicator?.user_id)} decides {row.object}. Her decision shows here next to
            the reviewers' answers.
          </Trans>
        </p>
      </div>
    );
  }
  if (row.state === "adjudicated" && row.decision) {
    return (
      <div className="grid gap-3">
        {head}
        <KeyValueList
          tight
          rows={[
            { icon: "user", label: t`Decided by`, value: nameOf(row.decision.by_user_id) ?? "" },
            {
              icon: "check",
              label: t`Decision`,
              value: styledWord(look.style, row.decision.raw, look.classes, row.ai.class_name),
            },
            {
              icon: "clock",
              label: t`When`,
              value: new Date(row.decision.at).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
            },
          ]}
        />
      </div>
    );
  }
  const disagreeing = row.answers
    .filter((answer) => answer.raw === "disagree")
    .map((answer) => nameOf(answer.user_id) ?? "");
  const mapping = t`Agree keeps the AI's call.${
    disagreeing.length
      ? t` Disagree goes with ${disagreeing.length === 2 ? "both reviewers" : disagreeing[0]}.`
      : ""
  }`;
  const declinedKeys = rows.filter((item) => item.state === "declined").map((item) => item.key);
  return (
    <div className="grid gap-3">
      {head}
      {row.edited ? (
        <div className="grid gap-2.5 rounded-zone bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] p-3 text-body-sm text-fg">
          <Icon name="warn" className="text-warn" />
          <span>
            <Trans>
              {row.object} was redrawn by {nameOf(row.edited.by_user_id)} on{" "}
            </Trans>
            {new Date(`${row.edited.on}T12:00:00`).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}
            <Trans>
              , after both reviewers decided. Their decisions are about the old outline.
            </Trans>
          </span>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onLookAgain}>
              <Trans>Ask both to look again</Trans>
            </Button>
            <Button variant="ghost" onClick={onKeep}>
              <Trans>Keep the decisions</Trans>
            </Button>
          </div>
        </div>
      ) : null}
      <DecisionButtons
        decisionStyle={look.style.kind}
        classes={look.classes}
        aiClass={row.ai.class_name}
        range={{ agreeFrom: look.style.agreeFrom, disagreeTo: look.style.disagreeTo }}
        label={t`Your decision on ${row.object}`}
        value={row.state === "decided" ? row.decision?.raw : undefined}
        onValueChange={onDecide}
      />
      {look.style.kind === "agree" ? (
        <p className="m-0 text-body-sm text-fg-dim">{mapping}</p>
      ) : null}
      {row.state === "declined" && row.adjudicator ? (
        <div className="grid gap-2 rounded-zone bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] p-3 text-body-sm text-fg">
          <Person {...personProp(person(row.adjudicator.user_id))} size={20} />
          <span>
            <Trans>Declined:</Trans> <q>{row.adjudicator.note}</q>
          </span>
          <Button
            className="justify-self-start"
            onClick={() => onSend(declinedKeys, row.adjudicator ? [row.adjudicator.user_id] : [])}
          >
            <Trans>Send to someone else</Trans>
          </Button>
        </div>
      ) : null}
      <div className="grid justify-items-start gap-2">
        <button type="button" className={linkClass} onClick={onEdit}>
          <Icon name="pen" />
          <Trans>Edit {row.object} myself in the viewer</Trans>
        </button>
        {row.state === "decided" ? null : (
          <>
            <button
              type="button"
              className={linkClass}
              onClick={() => onSend([row.key], reviewerIds)}
            >
              <Icon name="user" />
              <Trans>Send to an adjudicator</Trans>
            </button>
            {row.state === "left-open" ? null : (
              <button type="button" className={linkClass} onClick={onLeaveOpen}>
                <Icon name="clock" />
                <Trans>Leave open</Trans>
              </button>
            )}
          </>
        )}
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="queue-note" className="text-body-sm font-semibold">
          <Trans>
            Note for the record <span className="font-normal text-fg-dim">Optional</span>
          </Trans>
        </label>
        <Textarea
          id="queue-note"
          rows={2}
          placeholder={t`Why you decided this`}
          value={note}
          onChange={(event) => onNote(event.target.value)}
        />
      </div>
      <p className="m-0 text-body-sm text-fg-dim">
        <Trans>
          What you decide here is stored next to what the reviewers decided. Nothing they said is
          overwritten.
        </Trans>
      </p>
    </div>
  );
}
