import {
  getGetDisagreementQueueQueryKey,
  type QueueRow,
  useGetDisagreementQueue,
  useGetProject,
  useGetReviewTask,
  useNudgeReviewer,
  useSendToAdjudicator,
  useUpdateQueuedObject,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { KeyValueList } from "@parfocal/ui/components/connect-model";
import { DecisionButtons } from "@parfocal/ui/components/decision-buttons";
import {
  EvidenceList,
  EvidenceRow,
  QueueRow as QueueRowView,
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
import { useMockToast } from "../project/mock-toast.tsx";
import type { Camera } from "../review/slide-still.tsx";
import { SlideStill } from "../review/slide-still.tsx";
import { SendToAdjudicatorModal } from "./send-modal.tsx";
import {
  type Answer,
  answerText,
  answerTone,
  answerWord,
  canSend,
  claimText,
  isClosed,
  rowLabel,
  rowTag,
  stillOf,
} from "./text.ts";

export type QueueScene =
  | "queue"
  | "selected"
  | "sendadj"
  | "sent"
  | "lockedqueue"
  | "declined"
  | "edited";

const sentKeys = ["A1:T4", "A1:T5", "A1:T1·C145"];

type Filter = "all" | "rev" | "ai";

type SendDraft = { keys: string[]; excluded: string[] };

const firstSelected = (scene: QueueScene) =>
  scene === "selected" || scene === "sendadj" || scene === "declined"
    ? (sentKeys[0] ?? "A1:T2")
    : "A1:T2";

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function QueueScreen({ taskId, scene }: { taskId: string; scene: QueueScene }) {
  const queue = okData(useGetDisagreementQueue(taskId).data);
  const task = okData(useGetReviewTask(taskId).data);
  const project = okData(
    useGetProject(task?.project_id ?? "", { query: { enabled: Boolean(task) } }).data,
  );
  const person = usePeople();
  const nameOf = (userId: string | null | undefined) => person(userId)?.name;
  const renderLink = useRouterLink();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useMockToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedKey, setSelectedKey] = useState(firstSelected(scene));
  const [checked, setChecked] = useState<string[]>(
    scene === "selected" || scene === "sendadj" ? sentKeys : [],
  );
  const [send, setSend] = useState<SendDraft | null>(
    scene === "sendadj" ? { keys: sentKeys, excluded: [] } : null,
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [nudging, setNudging] = useState<{ userId: string; message: string } | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetDisagreementQueueQueryKey(taskId) });
  const update = useUpdateQueuedObject({ mutation: { onSuccess: () => void refresh() } });
  const sendTo = useSendToAdjudicator({ mutation: { onSuccess: () => void refresh() } });
  const nudge = useNudgeReviewer();
  const rows = queue?.rows ?? [];
  const row = rows.find((candidate) => candidate.key === selectedKey) ?? rows[0];
  const locked = queue?.locked ?? null;
  const reviewerIds = [...new Set(rows.flatMap((item) => item.answers.map((a) => a.user_id)))];
  const taskCode = task?.code ?? "RT-14";

  const select = (key: string) => {
    setSelectedKey(key);
    setCamera(null);
  };

  const decide = (target: QueueRow, raw: Answer) => {
    const note = notes[target.key]?.trim() || null;
    update.mutate({
      taskId,
      slideId: target.slide_id,
      object: target.object,
      data: { action: "decide", raw, note },
    });
    const at = rows.indexOf(target);
    const next = [...rows.slice(at + 1), ...rows.slice(0, at)].find(
      (candidate) => !isClosed(candidate),
    );
    if (next) select(next.key);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (send || nudging || locked || !row || checked.length > 0) return;
      if (row.state === "with-adjudicator" || row.state === "adjudicated") return;
      const raw = ({ k: "agree", x: "disagree", u: "unsure" } as const)[
        event.key.toLowerCase() as "k" | "x" | "u"
      ];
      if (raw) {
        event.preventDefault();
        decide(row, raw);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const nDiffer = rows.filter((item) => item.tag !== "bothai").length;
  const shown = rows.filter(
    (item) => filter === "all" || (filter === "ai") === (item.tag === "bothai"),
  );
  const resolved = rows.filter((item) =>
    ["decided", "left-open", "adjudicated"].includes(item.state),
  ).length;
  const withAdjudicator = rows.filter((item) => item.state === "with-adjudicator").length;
  const allClosed = rows.length > 0 && rows.every(isClosed);
  const lockedName = nameOf(locked?.user_id) ?? "A reviewer";
  const sub = locked
    ? `The queue opens when every reviewer has submitted. ${lockedName} has ${locked.slides_left} slides left.`
    : `${task?.name ?? ""} · ${rows.length} objects need a decision out of ${queue?.total_objects ?? 0} · ${resolved} resolved${withAdjudicator ? ` · ${withAdjudicator} with the adjudicator` : ""}`;
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
            `${picked.length} object${picked.length === 1 ? "" : "s"} sent to ${nameOf(adjudicatorId) ?? "the adjudicator"}`,
          ),
      },
    );
    setChecked([]);
    setSend(null);
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-7 pt-5 pb-5">
      <header className="flex items-end justify-between gap-4">
        <div className="grid gap-1">
          <Breadcrumbs
            renderLink={renderLink}
            items={[
              { label: "My work", href: destinations.myWork() },
              {
                label: project?.name ?? "Project",
                ...(task ? { href: destinations.project(task.project_id) } : {}),
              },
              {
                label: `${taskCode} · ${task?.name.split(" · ")[0] ?? ""}`,
                ...(task ? { href: `${destinations.project(task.project_id)}?tab=tasks` } : {}),
              },
              { label: "Disagreements" },
            ]}
          />
          <h1 className="m-0 text-[24px] font-semibold tracking-[-0.01em] text-fg">
            Disagreements in {taskCode}
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
                  message: `Hi ${lockedName.split(" ")[0]}, ${taskCode} is waiting on your last ${locked.slides_left} slides before its disagreements can be decided. Could you fit them in this week?`,
                })
              }
            >
              <Icon name="bell" />
              Nudge {lockedName.split(" ")[0]}
            </Button>
          ) : (
            <>
              <Button
                className="outline-1 outline-dashed outline-[#d946ef]"
                title="Mock persona switch"
                onClick={() =>
                  void navigate({
                    to: "/tasks/$taskId/disagreements",
                    params: { taskId },
                    search: { scene: "adjudicate" },
                  })
                }
              >
                <Icon name="users" />
                Preview the adjudicator view
              </Button>
              <Button
                variant={allClosed ? "primary" : "default"}
                title={
                  allClosed
                    ? "Every object is decided, left open or with the adjudicator"
                    : "Sign-off lists what is still open"
                }
                onClick={() => void navigate({ to: "/tasks/$taskId/sign-off", params: { taskId } })}
              >
                Go to sign-off
              </Button>
            </>
          )}
        </div>
      </header>
      <div className="grid min-h-0 grid-cols-[320px_minmax(0,1fr)_minmax(300px,300px)] items-start gap-5">
        <section aria-label="Queued objects" className="grid gap-1">
          <SegmentedControl
            aria-label="Show"
            className="mb-2"
            value={filter}
            disabled={Boolean(locked)}
            onValueChange={(value) => setFilter(value as Filter)}
            options={[
              { value: "all", label: `All ${rows.length}` },
              { value: "rev", label: `Reviewers differ ${nDiffer}` },
              { value: "ai", label: `Both vs AI ${rows.length - nDiffer}` },
            ]}
          />
          {shown.map((item) => {
            const tag = rowTag(item, nameOf);
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
                onCheckedChange={(on) =>
                  setChecked((now) =>
                    on ? [...now, item.key] : now.filter((key) => key !== item.key),
                  )
                }
              />
            );
          })}
        </section>
        {locked ? (
          <section className="col-span-2 grid min-h-60 place-items-center rounded-zone bg-surf-panel p-8 text-center">
            <div className="grid justify-items-center gap-2 text-body-sm text-fg-dim">
              <Icon name="lock" size="md" />
              <b className="text-fg">Nothing to decide yet</b>
              <span>Decisions open here once both reviews are in.</span>
            </div>
          </section>
        ) : row ? (
          <>
            <section aria-label={`Evidence for ${rowLabel(row)}`} className="grid gap-3">
              <div className="relative h-[360px] overflow-hidden rounded-zone bg-canvas">
                <SlideStill
                  view={stillOf(row)}
                  camera={camera}
                  onCameraChange={setCamera}
                  regionDecisions={{}}
                  className="h-full"
                  minimap={false}
                  hint={false}
                  slideName={row.slide_label}
                />
              </div>
              <EvidenceList>
                <EvidenceRow icon="smart" title="AI · CAMELYON v1.0">
                  {claimText(row.ai)}
                </EvidenceRow>
                {row.answers.map((answer) => (
                  <EvidenceRow
                    key={answer.user_id}
                    title={<Person {...personProp(person(answer.user_id))} size={20} />}
                  >
                    {row.state === "look-again" ? (
                      <StatusTag tone="accent">open again</StatusTag>
                    ) : (
                      <>
                        <StatusTag tone={answerTone[answer.raw]}>{answerText(answer)}</StatusTag>
                        {answer.note ? <QuotedNote>{answer.note}</QuotedNote> : null}
                      </>
                    )}
                  </EvidenceRow>
                ))}
                <EvidenceRow icon="check" title="Decision">
                  {row.decision ? (
                    <>
                      <StatusTag tone={answerTone[row.decision.raw]}>
                        {answerWord[row.decision.raw]}
                      </StatusTag>
                      {row.state === "adjudicated" ? (
                        <small className="text-caption text-fg-dim">
                          {nameOf(row.decision.by_user_id)}, adjudicator
                        </small>
                      ) : row.decision.note ? (
                        <QuotedNote>{row.decision.note}</QuotedNote>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-fg-dim">Not decided yet</span>
                  )}
                </EvidenceRow>
              </EvidenceList>
            </section>
            <aside aria-label="Decide" className="rounded-zone bg-surf-panel p-4">
              {checkedRows.length > 0 ? (
                <div className="grid gap-3">
                  <div className="flex items-center justify-between">
                    <b className="text-body font-semibold">
                      {checkedRows.length} object{checkedRows.length > 1 ? "s" : ""} selected
                    </b>
                    <Button size="sm" variant="ghost" onClick={() => setChecked([])}>
                      Clear
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
                    Send to an adjudicator
                  </Button>
                  <p className="m-0 text-body-sm text-fg-dim">
                    The reviewers of {taskCode} cannot be picked. The adjudicator sees them as
                    Reviewer A and Reviewer B.
                  </p>
                </div>
              ) : (
                <DecidePanel
                  row={row}
                  rows={rows}
                  note={notes[row.key] ?? row.decision?.note ?? ""}
                  nameOf={nameOf}
                  person={person}
                  onNote={(text) => setNotes((now) => ({ ...now, [row.key]: text }))}
                  onDecide={(raw) => decide(row, raw)}
                  onLeaveOpen={() => {
                    update.mutate({
                      taskId,
                      slideId: row.slide_id,
                      object: row.object,
                      data: { action: "leave-open", note: notes[row.key]?.trim() || null },
                    });
                    toast.show(`${rowLabel(row)} is left open. Sign-off counts it on purpose.`);
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
                      object: row.object,
                      data: { action: "look-again" },
                    });
                    toast.show(`Both reviewers have ${row.object} open again`);
                  }}
                  onKeep={() =>
                    update.mutate({
                      taskId,
                      slideId: row.slide_id,
                      object: row.object,
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
            toast.show(`Nudge sent to ${nameOf(nudging.userId) ?? "the reviewer"}`);
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
  note: string;
  reviewerIds: string[];
  nameOf: (userId: string | null | undefined) => string | undefined;
  person: ReturnType<typeof usePeople>;
  onNote: (text: string) => void;
  onDecide: (raw: Answer) => void;
  onLeaveOpen: () => void;
  onSend: (keys: string[], excluded: string[]) => void;
  onEdit: () => void;
  onLookAgain: () => void;
  onKeep: () => void;
};

const linkClass =
  "inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-body-sm text-accent hover:underline";

function DecidePanel({
  row,
  rows,
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
  const tag = rowTag(row, nameOf);
  const label = rowLabel(row);
  const head = (
    <div className="flex items-center justify-between gap-2">
      <b className="flex items-center gap-2 text-body font-semibold">
        Decide <ObjectIdTag>{label}</ObjectIdTag>
      </b>
      <StatusTag tone={tag.tone}>{tag.label}</StatusTag>
    </div>
  );
  if (row.state === "look-again") {
    return (
      <div className="grid gap-3">
        {head}
        <p className="m-0 text-body-sm text-fg-dim">
          Both reviewers have {row.object} open again with your note. It comes back here when they
          decide.
        </p>
      </div>
    );
  }
  if (row.state === "with-adjudicator") {
    return (
      <div className="grid gap-3">
        {head}
        <p className="m-0 text-body-sm text-fg-dim">
          {nameOf(row.adjudicator?.user_id)} decides {row.object}. Her decision shows here next to
          the reviewers' answers.
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
            { icon: "user", label: "Decided by", value: nameOf(row.decision.by_user_id) ?? "" },
            { icon: "check", label: "Decision", value: answerWord[row.decision.raw] },
            {
              icon: "clock",
              label: "When",
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
  const mapping = `Agree keeps the AI's call.${
    disagreeing.length
      ? ` Disagree goes with ${disagreeing.length === 2 ? "both reviewers" : disagreeing[0]}.`
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
            {row.object} was redrawn by {nameOf(row.edited.by_user_id)} on{" "}
            {new Date(`${row.edited.on}T12:00:00`).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}
            , after both reviewers decided. Their decisions are about the old outline.
          </span>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onLookAgain}>Ask both to look again</Button>
            <Button variant="ghost" onClick={onKeep}>
              Keep the decisions
            </Button>
          </div>
        </div>
      ) : null}
      <DecisionButtons
        decisionStyle="agree"
        label={`Your decision on ${row.object}`}
        value={row.state === "decided" ? row.decision?.raw : undefined}
        onValueChange={(raw) => onDecide(raw as Answer)}
      />
      <p className="m-0 text-body-sm text-fg-dim">{mapping}</p>
      {row.state === "declined" && row.adjudicator ? (
        <div className="grid gap-2 rounded-zone bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] p-3 text-body-sm text-fg">
          <Person {...personProp(person(row.adjudicator.user_id))} size={20} />
          <span>
            Declined: <q>{row.adjudicator.note}</q>
          </span>
          <Button
            className="justify-self-start"
            onClick={() => onSend(declinedKeys, row.adjudicator ? [row.adjudicator.user_id] : [])}
          >
            Send to someone else
          </Button>
        </div>
      ) : null}
      <div className="grid justify-items-start gap-2">
        <button type="button" className={linkClass} onClick={onEdit}>
          <Icon name="pen" />
          Edit {row.object} myself in the viewer
        </button>
        {row.state === "decided" ? null : (
          <>
            <button
              type="button"
              className={linkClass}
              onClick={() => onSend([row.key], reviewerIds)}
            >
              <Icon name="user" />
              Send to an adjudicator
            </button>
            {row.state === "left-open" ? null : (
              <button type="button" className={linkClass} onClick={onLeaveOpen}>
                <Icon name="clock" />
                Leave open
              </button>
            )}
          </>
        )}
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="queue-note" className="text-body-sm font-semibold">
          Note for the record <span className="font-normal text-fg-dim">Optional</span>
        </label>
        <Textarea
          id="queue-note"
          rows={2}
          placeholder="Why you decided this"
          value={note}
          onChange={(event) => onNote(event.target.value)}
        />
      </div>
      <p className="m-0 text-body-sm text-fg-dim">
        What you decide here is stored next to what the reviewers decided. Nothing they said is
        overwritten.
      </p>
    </div>
  );
}
