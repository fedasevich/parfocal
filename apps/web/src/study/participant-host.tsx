import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { RadioGroup, RadioRow } from "@parfocal/ui/components/radio-group";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type ParticipantRun, useParticipantRun, writeRun } from "./participant-run.ts";
import { useStudyContext } from "./study-context.ts";
import { giveUpAfterMs, giveUpReasonKeys, giveUpReasons } from "./study-copy.ts";
import {
  blockedCount,
  checkMet,
  type PageProbe,
  recordBlock,
  recordTask,
  resolveGuard,
  roundTasks,
  type StudyTask,
} from "./study-model.ts";
import {
  clearBlockLog,
  readBlockLog,
  readStudy,
  updateStudy,
  writeGuard,
} from "./study-storage.ts";
import { startStudyUpload, uploadingSink } from "./study-upload.ts";
import { startTaskMeter, studyUiAttribute, type TaskMeter } from "./task-metrics.ts";
import { readStageCameras } from "./trace/stage-cameras.ts";
import { createRecorder, type FrameTools, type Recorder } from "./trace/trace-recorder.ts";
import { createBatcher, indexedDbSink } from "./trace/trace-store.ts";
import { useStudy } from "./use-study.ts";

const stamp = () => Date.now();

const traceClock = () => Math.round(performance.timeOrigin + performance.now());

const outsideStudy = (element: Element) => element.closest(`[${studyUiAttribute}]`) === null;

const appProbe = (): PageProbe => ({
  url: `${window.location.pathname}${window.location.search}`,
  count: (selector) => [...document.querySelectorAll(selector)].filter(outsideStudy).length,
  text: () =>
    [...document.body.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .filter(outsideStudy)
      .map((element) => element.innerText)
      .join("\n"),
});

const drainBlocks = () => {
  const entries = readBlockLog();
  if (entries.length === 0) return;
  clearBlockLog();
  updateStudy((state) =>
    entries.reduce(
      (next, entry) =>
        recordBlock(next, entry.sessionId, { taskId: entry.taskId, at: entry.at, to: entry.to }),
      state,
    ),
  );
};

export default function ParticipantHost() {
  const run = useParticipantRun();
  const sessionId = run?.sessionId;
  const recorder = useRef<Recorder | null>(null);

  useEffect(() => startStudyUpload(), []);

  useEffect(() => {
    if (sessionId === undefined) return;
    let frames: FrameTools | undefined;
    let cancelled = false;
    import("./trace/dom-frames.ts").then(
      (module) => {
        if (cancelled) return;
        frames = { captureFrame: module.captureFrame, captureHead: module.captureHead };
      },
      () => undefined,
    );
    const active = createRecorder({
      batcher: createBatcher(
        sessionId,
        uploadingSink(indexedDbSink()),
        undefined,
        undefined,
        Date.now(),
      ),
      now: traceClock,
      frames: () => frames,
      cameras: () => readStageCameras(),
    });
    active.attach(window);
    recorder.current = active;
    return () => {
      cancelled = true;
      recorder.current = null;
      void active.stop();
    };
  }, [sessionId]);

  if (run === undefined || sessionId === undefined || run.phase !== "task") return null;
  return (
    <TaskBar
      key={`${run.index}-${run.taskStartedAt ?? 0}`}
      run={run}
      sessionId={sessionId}
      recorder={recorder}
    />
  );
}

function TaskBar({
  run,
  sessionId,
  recorder,
}: {
  run: ParticipantRun;
  sessionId: string;
  recorder: { current: Recorder | null };
}) {
  const { i18n, t } = useLingui();
  const router = useRouter();
  const context = useStudyContext(run.code);
  const state = useStudy();
  const session = state.sessions.find((entry) => entry.id === sessionId);
  const tasks = roundTasks(state, session);
  const task: StudyTask | undefined = tasks[run.index];
  const startedAt = run.taskStartedAt ?? stamp();
  const meter = useRef<TaskMeter | null>(null);
  const ended = useRef(false);
  const [canGiveUp, setCanGiveUp] = useState(() => stamp() - startedAt >= giveUpAfterMs);
  const [giveUpAt, setGiveUpAt] = useState<number | null>(null);
  const [reason, setReason] = useState<string>("");
  const guard = task === undefined ? undefined : resolveGuard(task, sessionId, context);
  const guardKey = guard === undefined ? "" : JSON.stringify(guard);

  const taskId = task?.id;
  const firstClick = task?.firstClick;

  useEffect(() => {
    if (taskId === undefined) return;
    meter.current = startTaskMeter(document, undefined, firstClick);
    recorder.current?.mark(taskId, "start");
    return () => {
      meter.current?.stop();
      meter.current = null;
    };
  }, [taskId, firstClick, recorder]);

  useEffect(() => {
    writeGuard(guardKey === "" ? undefined : (JSON.parse(guardKey) as typeof guard));
    return () => writeGuard(undefined);
  }, [guardKey]);

  const finish = (success: boolean, end: number, why: string | null) => {
    if (task === undefined || ended.current) return;
    ended.current = true;
    writeGuard(undefined);
    drainBlocks();
    const counts = meter.current?.counts() ?? { clicks: 0, deadClicks: 0, keys: 0, wheels: 0 };
    const moves = meter.current?.firstMoves() ?? {
      timeToFirstActionMs: null,
      firstClickCorrect: null,
      pathStraightness: null,
    };
    const known = readStudy().sessions.find((entry) => entry.id === sessionId);
    updateStudy((current) =>
      recordTask(
        current,
        sessionId,
        {
          id: task.id,
          idx: run.index,
          title: task.title,
          goal: task.instruction,
          success,
          durationMs: Math.max(0, end - startedAt),
          clicks: counts.clicks,
          deadClicks: counts.deadClicks,
          blocked: known === undefined ? 0 : blockedCount(known, task.id),
          keys: counts.keys,
          wheels: counts.wheels,
          seq: null,
          notes: {},
          reason: why,
          endedAt: end,
          ...moves,
        },
        startedAt,
      ),
    );
    recorder.current?.mark(task.id, "end", success ? "done" : "gave-up");
    writeRun({ ...run, phase: "seq" });
    router.history.push("/study");
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      drainBlocks();
      if (stamp() - startedAt >= giveUpAfterMs) setCanGiveUp(true);
      if (task?.check === undefined || giveUpAt !== null) return;
      if (window.location.pathname === "/study") return;
      if (checkMet(task, context, appProbe())) finish(true, stamp(), null);
    }, 500);
    return () => window.clearInterval(timer);
  });

  if (task === undefined) return null;

  const closeGiveUp = () => {
    setGiveUpAt(null);
    setReason("");
  };

  return (
    <>
      {createPortal(
        <div
          {...{ [studyUiAttribute]: "" }}
          className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
        >
          <section
            aria-label={t`Study task`}
            className="pointer-events-auto flex max-w-3xl items-center gap-3 rounded-[14px] border border-line bg-surf-panel px-4 py-2.5 shadow-pop"
            data-testid="study-task-bar"
          >
            <span className="shrink-0 text-caption font-semibold text-accent">
              <Trans>
                Task {run.index + 1} of {tasks.length}
              </Trans>
            </span>
            <p className="min-w-0 text-body text-fg" data-testid="study-goal">
              {task.instruction}
            </p>
            {task.check === undefined ? (
              <Button variant="primary" size="sm" onClick={() => finish(true, stamp(), null)}>
                <Trans>I'm done</Trans>
              </Button>
            ) : null}
            {canGiveUp ? (
              <Button size="sm" onClick={() => setGiveUpAt(stamp())}>
                <Trans>I can't find it</Trans>
              </Button>
            ) : null}
          </section>
        </div>,
        document.body,
      )}
      <SmallModal
        open={giveUpAt !== null}
        onOpenChange={(open) => {
          if (!open) closeGiveUp();
        }}
        title={<Trans>What got in the way?</Trans>}
        subtitle={
          <Trans>Choose the answer that fits best. You can also go back and keep trying.</Trans>
        }
        primaryLabel={<Trans>Continue</Trans>}
        primaryDisabled={reason === ""}
        onPrimary={() => {
          if (giveUpAt !== null && reason !== "") finish(false, giveUpAt, reason);
        }}
        cancelLabel={t`Back to the task`}
        onCancel={closeGiveUp}
      >
        <RadioGroup
          aria-label={t`Reason`}
          value={reason}
          onValueChange={(value) => setReason(String(value))}
        >
          {giveUpReasonKeys.map((key, index) => {
            const label = giveUpReasons[index];
            return label === undefined ? null : (
              <RadioRow key={key} value={key} title={i18n._(label)} />
            );
          })}
        </RadioGroup>
      </SmallModal>
    </>
  );
}
