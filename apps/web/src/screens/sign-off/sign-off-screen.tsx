import {
  getGetReviewTaskStatesQueryKey,
  getGetSignOffSummaryQueryKey,
  getListReviewTasksQueryKey,
  type SignOffSummary,
  useGetMe,
  useGetReviewTask,
  useGetSignOffSummary,
  useGetTaskEvaluation,
  useSignOffReviewTask,
  useStartEvaluationVersion,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { KeyValueList } from "@parfocal/ui/components/connect-model";
import { ReadinessList, ReadinessRow } from "@parfocal/ui/components/disagreements";
import { MetricTiles } from "@parfocal/ui/components/evaluation-report";
import { Icon } from "@parfocal/ui/components/icon";
import { Person } from "@parfocal/ui/components/person";
import { SmallModal, SmallModalZone } from "@parfocal/ui/components/small-modal";
import { StatusTag } from "@parfocal/ui/components/tag";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTaskRun } from "../../telemetry/use-task-timing.ts";
import { closeOn, ReasonModal, useSignature } from "../clinical-report/modals.tsx";
import { headlineTiles } from "../evaluation/numbers.ts";
import { andJoin } from "../format.ts";
import { ProjectBackground } from "../jobs/project-background.tsx";
import { personProp, usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { useMockToast } from "../project/mock-toast.tsx";

export type SignOffScene = "blocked" | "ready" | "ssofail" | "signed" | "amend";

const exportsList = [
  { key: "pdf", label: "Evaluation report", format: "PDF" },
  { key: "csv", label: "Decisions per object", format: "CSV" },
  { key: "json", label: "Reviewed annotations", format: "Parfocal JSON and GeoJSON" },
  { key: "forms", label: "Opinion forms", format: "CSV" },
];

const longDate = (iso: string) => {
  const date = new Date(iso);
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

const shortDate = (iso: string) => {
  const date = new Date(iso);
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

export function SignOffScreen({ taskId, scene }: { taskId: string; scene: SignOffScene }) {
  const task = okData(useGetReviewTask(taskId).data);
  if (!task) return null;
  return (
    <ProjectBackground projectId={task.project_id} tab="tasks">
      <SignOffModal
        key={scene}
        taskId={taskId}
        projectId={task.project_id}
        taskCode={task.code}
        taskName={task.name}
        scene={scene}
      />
    </ProjectBackground>
  );
}

function SignOffModal({
  taskId,
  projectId,
  taskCode,
  taskName,
  scene,
}: {
  taskId: string;
  projectId: string;
  taskCode: string;
  taskName: string;
  scene: SignOffScene;
}) {
  const summary = okData(useGetSignOffSummary(taskId).data);
  const evaluation = okData(useGetTaskEvaluation(taskId).data);
  const me = okData(useGetMe().data);
  const person = usePeople();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useMockToast();
  const timing = useTaskRun("report", taskId, "reports");
  const [amending, setAmending] = useState(scene === "amend");
  const [signingNext, setSigningNext] = useState(false);
  const [picked, setPicked] = useState(["pdf", "csv", "json"]);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetSignOffSummaryQueryKey(taskId) }),
      queryClient.invalidateQueries({ queryKey: getGetReviewTaskStatesQueryKey(taskId) }),
      queryClient.invalidateQueries({ queryKey: getListReviewTasksQueryKey(projectId) }),
    ]);
  const sign = useSignOffReviewTask();
  const start = useStartEvaluationVersion();
  const signature = useSignature({
    failed: scene === "ssofail",
    email: me?.email ?? "",
    onSign: (method, done) =>
      sign.mutate(
        { taskId, data: { confirmed_with: method } },
        {
          onSuccess: () => {
            done(true);
            timing.finish();
            setSigningNext(false);
            void refresh();
            toast.show(`Evaluation v${signingVersion} is signed. Reviewers are told.`);
          },
          onError: () => done(false),
        },
      ),
  });
  const toProject = () =>
    void navigate({ to: "/projects/$projectId", params: { projectId }, search: { tab: "tasks" } });
  const subtitle = `${taskName} · Sentinel node AI evaluation`;
  const signingVersion = summary?.next_version?.version ?? summary?.version ?? 1;
  if (!summary) return null;
  const nameOf = (userId: string) => person(userId)?.name ?? "";

  if (summary.signature && !signingNext) {
    const signed = summary.signature;
    return (
      <>
        <SmallModal
          open={!amending}
          onOpenChange={closeOn(toProject)}
          width={560}
          title={`Sign off ${taskCode}`}
          subtitle={subtitle}
          hint="Changes after sign-off are logged, and the report marks them."
          showCancel={false}
          secondaryAction={
            summary.next_version ? (
              <Button onClick={() => setSigningNext(true)}>
                Sign v{summary.next_version.version}
              </Button>
            ) : (
              <Button onClick={() => setAmending(true)}>Start v2</Button>
            )
          }
          primaryLabel={
            <>
              <Icon name="file" />
              Open the evaluation report
            </>
          }
          onPrimary={() => void navigate({ to: "/tasks/$taskId/evaluation", params: { taskId } })}
        >
          <SmallModalZone
            title={
              <>
                Evaluation v{summary.version} · signed{" "}
                <StatusTag tone="accent">Soft lock</StatusTag>
              </>
            }
          >
            <KeyValueList
              rows={[
                {
                  icon: "user",
                  label: "Signed by",
                  value: signed.by_user_id ? nameOf(signed.by_user_id) : "",
                },
                { icon: "calendar", label: "When", value: longDate(signed.at) },
                {
                  icon: "shield",
                  label: "Checksum",
                  value: <span className="font-mono">{signed.checksum}</span>,
                },
              ]}
            />
          </SmallModalZone>
          {summary.next_version ? (
            <SmallModalZone title="Next version">
              <ChangeLine
                who={person(summary.next_version.by_user_id)}
                at="Just now"
                text={
                  <>
                    <b>Evaluation v{summary.next_version.version} · draft</b>, started from v
                    {summary.version} · "{summary.next_version.reason}"
                  </>
                }
              />
            </SmallModalZone>
          ) : null}
          <SmallModalZone title="Export">
            <div className="grid gap-2.5">
              {exportsList.map((item) => (
                <label
                  key={item.key}
                  className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-body-sm"
                >
                  <Checkbox
                    checked={picked.includes(item.key)}
                    onCheckedChange={(on) =>
                      setPicked((now) =>
                        on ? [...now, item.key] : now.filter((key) => key !== item.key),
                      )
                    }
                  />
                  <span className="font-medium">{item.label}</span>
                  <span className="text-fg-dim">{item.format}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Button
                disabled={picked.length === 0}
                onClick={() =>
                  toast.show(
                    `${plural(picked.length, "file")} downloading: ${andJoin(
                      exportsList
                        .filter((item) => picked.includes(item.key))
                        .map((item) => item.label.toLowerCase()),
                    )}`,
                  )
                }
              >
                <Icon name="download" />
                {picked.length ? `Download ${plural(picked.length, "file")}` : "Download"}
              </Button>
              {picked.length ? null : (
                <span className="text-body-sm text-fg-dim">Pick at least one file</span>
              )}
            </div>
          </SmallModalZone>
          {summary.changes.length ? (
            <SmallModalZone title="Changed after sign-off">
              {summary.changes.map((change) => (
                <ChangeLine
                  key={`${change.object}-${change.at}`}
                  who={person(change.by_user_id)}
                  at={shortDate(change.at)}
                  text={
                    <>
                      <b>
                        {change.object} on {change.slide_label}
                      </b>
                      : {change.text} · "{change.reason}"
                    </>
                  }
                />
              ))}
            </SmallModalZone>
          ) : null}
        </SmallModal>
        {amending ? (
          <ReasonModal
            title="Start Evaluation v2"
            subtitle={`${taskCode} · Evaluation v${summary.version} signed ${longDate(signed.at)}`}
            whatLabel="What changes"
            what="A new draft, Evaluation v2, copied from v1"
            told={`${andJoin(summary.reviewer_ids.map(nameOf))}, the reviewers of ${taskCode}`}
            label="Reason"
            placeholder="For example, measured again on deeper levels of A1"
            help="The reason goes into the report."
            hint="v1 stays readable as it was signed."
            primary="Start v2"
            tooShort="Give a reason of at least 10 characters."
            tried={scene === "amend"}
            onClose={() => setAmending(false)}
            onSubmit={(reason) =>
              start.mutate(
                { taskId, data: { reason } },
                {
                  onSuccess: () => {
                    setAmending(false);
                    void refresh();
                    toast.show("Evaluation v2 started from v1. v1 stays as it was signed.");
                  },
                },
              )
            }
          />
        ) : null}
        {toast.node}
      </>
    );
  }

  const blockers = blockersOf(summary, nameOf);
  const busy = signature.busy || sign.isPending;
  return (
    <>
      <SmallModal
        open
        onOpenChange={closeOn(toProject)}
        width={560}
        title={
          summary.next_version
            ? `Sign off ${taskCode} · v${summary.next_version.version}`
            : `Sign off ${taskCode}`
        }
        subtitle={subtitle}
        hint={
          blockers.length
            ? `${blockers.length} thing${blockers.length === 1 ? "" : "s"} to finish first.`
            : busy
              ? "Waiting for Vltava single sign-on…"
              : "Reviewers are told once signed."
        }
        cancelLabel="Back to disagreements"
        onCancel={() => void navigate({ to: "/tasks/$taskId/disagreements", params: { taskId } })}
        primaryLabel={signature.label}
        primaryDisabled={blockers.length > 0}
        primaryBusy={busy}
        onPrimary={signature.run}
      >
        <SmallModalZone title={blockers.length ? "Before you can sign" : "Ready to sign"}>
          <ReadinessList>
            {blockers.length ? (
              blockers.map((blocker) => (
                <ReadinessRow
                  key={blocker.key}
                  tone="warn"
                  title={blocker.title}
                  sub={blocker.sub}
                  action={
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-accent"
                      onClick={() =>
                        void navigate(
                          blocker.key === "reviews"
                            ? { to: "/team", search: { scene: "signoff" } }
                            : { to: "/tasks/$taskId/disagreements", params: { taskId } },
                        )
                      }
                    >
                      Go to
                    </Button>
                  }
                />
              ))
            ) : (
              <>
                <ReadinessRow
                  tone="ok"
                  title={`All ${summary.reviews.slides} slides reviewed by both reviewers`}
                  sub={`${summary.reviews.submitted} of ${summary.reviews.total} reviews submitted, ${summary.reviews.opinion_forms} opinion forms`}
                />
                <ReadinessRow
                  tone="ok"
                  title={`${summary.queue.total} disagreements resolved`}
                  sub={resolvedText(summary, nameOf)}
                />
                {summary.queue.left_open.length ? (
                  <ReadinessRow
                    tone="warn"
                    title={`${summary.queue.left_open.length} objects left open on purpose`}
                    sub={`${summary.queue.left_open.map((row) => `${row.object} on ${row.slide_label}`).join(", ")} · allowed, in the report`}
                  />
                ) : null}
              </>
            )}
            {summary.open_threads.total ? (
              <ReadinessRow
                tone="warn"
                title={`${plural(summary.open_threads.total, "thread")} still open`}
                sub={`${summary.open_threads.slides.map((row) => `${row.count} on ${row.slide_label}`).join(", ")} · they do not block signing, the report lists them`}
              />
            ) : null}
            <ReadinessRow
              tone="ok"
              title="Result set and IDs fixed"
              sub={`${summary.result_set.name}, ${summary.result_set.objects} objects, plus ${summary.result_set.added} added by a reviewer`}
            />
          </ReadinessList>
        </SmallModalZone>
        <SmallModalZone title="Results">
          <MetricTiles variant="panel" tiles={evaluation ? headlineTiles(evaluation) : []} />
        </SmallModalZone>
        <SmallModalZone title="What signing does">
          <p className="m-0 text-body-sm leading-[1.5] text-fg">
            It freezes <b>Evaluation v{summary.version}</b>: the result set, every decision, edit,
            comment and opinion, and the IDs, with a checksum. You can still change things
            afterwards. Each change is logged with a reason and the report shows it.
          </p>
        </SmallModalZone>
        {busy || blockers.length ? null : signature.zone}
      </SmallModal>
      {toast.node}
    </>
  );
}

function ChangeLine({
  who,
  at,
  text,
}: {
  who: ReturnType<ReturnType<typeof usePeople>>;
  at: string;
  text: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 text-body-sm">
      <Person {...personProp(who)} size={20} />
      <span>{text}</span>
      <small className="text-caption text-fg-dim">{at}</small>
    </div>
  );
}

function blockersOf(summary: SignOffSummary, nameOf: (userId: string) => string) {
  const list: { key: string; title: string; sub: string }[] = [];
  const pending = summary.reviews.total - summary.reviews.submitted;
  if (pending > 0) {
    list.push({
      key: "reviews",
      title: `${pending} reviews not submitted`,
      sub: andJoin(
        summary.reviews.behind.map(
          (row) => `${nameOf(row.user_id)} has ${plural(row.slides_left, "slide")} left`,
        ),
      ),
    });
  }
  const open = summary.queue.total - summary.queue.resolved;
  if (open > 0) {
    const waiting = summary.queue.with_adjudicator
      .map((row) => `${row.count} with ${nameOf(row.user_id)}`)
      .join(", ");
    list.push({
      key: "queue",
      title: `${open} disagreements not resolved`,
      sub: `${summary.queue.resolved} of ${summary.queue.total} resolved so far${waiting ? `, ${waiting}` : ""}`,
    });
  }
  return list;
}

function resolvedText(summary: SignOffSummary, nameOf: (userId: string) => string) {
  const parts = [`${summary.queue.by_researcher} by you`];
  for (const row of summary.queue.by_adjudicator)
    parts.push(`${row.count} by ${nameOf(row.user_id)}`);
  if (summary.queue.left_open.length) parts.push(`${summary.queue.left_open.length} left open`);
  return parts.join(", ");
}
