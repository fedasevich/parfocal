import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Label } from "@parfocal/ui/components/label";
import { Textarea } from "@parfocal/ui/components/textarea";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useId, useState } from "react";
import { freshRun, type ParticipantRun, useParticipantRun, writeRun } from "./participant-run.ts";
import { RatingScale } from "./rating-scale.tsx";
import { useParticipantLookup, useStudyContext } from "./study-context.ts";
import {
  finalQuestions,
  readDelayMs,
  seqEnds,
  seqQuestion,
  susEnds,
  susItems,
  taskNoteLabels,
} from "./study-copy.ts";
import {
  answerFinal,
  answerTask,
  emptyFinal,
  type FinalTextKey,
  finalTextKeys,
  finishFinal,
  resolveStartPath,
  roundTasks,
  type StudySession,
  type StudyTask,
  startParticipantSession,
  type TaskNotes,
  taskNoteKeys,
} from "./study-model.ts";
import { updateStudy } from "./study-storage.ts";
import { useUploadState } from "./study-upload.ts";
import { useStudy } from "./use-study.ts";

const stamp = () => Date.now();

function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const upload = useUploadState();
  return (
    <main
      className="grid min-h-dvh place-items-center bg-surf-app p-6 text-fg"
      data-testid="study-participant"
      data-upload={upload}
    >
      <section
        className={`grid w-full gap-5 rounded-[14px] border border-line bg-surf-panel p-8 shadow-pop ${wide ? "max-w-3xl" : "max-w-xl"}`}
      >
        {children}
      </section>
    </main>
  );
}

const Kicker = ({ children }: { children: ReactNode }) => (
  <span className="text-caption font-semibold tracking-wide text-accent uppercase">{children}</span>
);

const Actions = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
);

export function ParticipantScreen() {
  const run = useParticipantRun();
  const state = useStudy();

  useEffect(() => {
    if (run === undefined) writeRun(freshRun());
  }, [run]);

  if (run === undefined) return null;
  const session = state.sessions.find((entry) => entry.id === run.sessionId);
  const tasks = roundTasks(state, session);

  if (run.phase === "consent" || session === undefined) {
    return <Consent run={run} taskCount={tasks.length} />;
  }
  if (run.phase === "intro" || run.phase === "task") {
    const task = tasks[run.index];
    if (task === undefined) return null;
    return <TaskIntro key={run.index} run={run} task={task} total={tasks.length} />;
  }
  if (run.phase === "seq") {
    const record = session.tasks?.[session.tasks.length - 1];
    if (record === undefined) return null;
    return (
      <TaskReview
        key={record.id}
        run={run}
        session={session}
        success={record.success}
        last={run.index + 1 >= tasks.length}
      />
    );
  }
  if (run.phase === "final") {
    return <FinalBlock key={run.finalStep} run={run} session={session} />;
  }
  return <Thanks />;
}

function Point({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <li className="grid gap-0.5">
      <strong className="text-body font-semibold text-fg">{title}</strong>
      <span className="text-body-sm text-fg-dim">{children}</span>
    </li>
  );
}

function Consent({ run, taskCount }: { run: ParticipantRun; taskCount: number }) {
  const [recorder, setRecorder] = useState<"ready" | "blocked">("ready");
  useEffect(() => {
    import("./trace/dom-frames.ts").catch(() => setRecorder("blocked"));
  }, []);

  const agree = () => {
    const at = stamp();
    const id = `s-${at.toString(36)}-${run.code.toLowerCase()}`;
    updateStudy((state) => startParticipantSession(state, run.code, id, at));
    writeRun({ ...run, phase: "intro", sessionId: id, index: 0, finalStep: 0 });
  };

  return (
    <Page wide>
      <Kicker>
        <Trans>Usability study</Trans>
      </Kicker>
      <h1 className="text-page-title font-semibold">
        <Trans>Help us test Parfocal</Trans>
      </h1>
      {recorder === "blocked" ? (
        <p role="alert" className="text-danger" data-testid="study-recorder-warning">
          <Trans>
            Your browser blocked part of the study. An ad blocker or privacy extension stopped the
            screen recorder from loading. Turn it off for this site, then reload the page.
          </Trans>
        </p>
      ) : null}
      <p className="text-body text-fg">
        <Trans>
          You will try an app where doctors review what an AI found on tissue scans. You do not need
          any medical knowledge.
        </Trans>
      </p>
      <ul className="grid gap-3">
        <Point title={<Trans>We test the app, not you</Trans>}>
          <Trans>If something is hard to find, that is what we want to learn.</Trans>
        </Point>
        <Point title={<Trans>{taskCount} short tasks</Trans>}>
          <Trans>Reach each goal your own way. The moderator watches but does not help.</Trans>
        </Point>
        <Point title={<Trans>Think aloud</Trans>}>
          <Trans>Say what you look for and what you expect to happen.</Trans>
        </Point>
        <Point title={<Trans>This tab is recorded</Trans>}>
          <Trans>Screen, mouse movements, clicks and key presses. No camera, no microphone.</Trans>
        </Point>
        <Point title={<Trans>You stay anonymous</Trans>}>
          <Trans>
            Your code is{" "}
            <span className="font-mono text-fg" data-testid="study-code">
              {run.code}
            </span>
          </Trans>
        </Point>
      </ul>
      <Actions>
        <Button variant="primary" size="lg" onClick={agree}>
          <Trans>I agree and start</Trans>
        </Button>
      </Actions>
    </Page>
  );
}

function TaskIntro({ run, task, total }: { run: ParticipantRun; task: StudyTask; total: number }) {
  const context = useStudyContext(run.code);
  const lookup = useParticipantLookup(run.code);
  const router = useRouter();
  const [readyAt] = useState(() => Date.now() + readDelayMs);
  const [left, setLeft] = useState(() => Math.ceil(readDelayMs / 1000));
  const startPath = task.startPath === undefined ? "/" : resolveStartPath(task, context);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLeft(Math.max(0, Math.ceil((readyAt - Date.now()) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [readyAt]);

  const start = () => {
    if (startPath === undefined) return;
    writeRun({ ...run, phase: "task", taskStartedAt: stamp() });
    router.history.push(startPath);
  };

  if (run.phase === "task") {
    return (
      <Page>
        <Kicker>
          <Trans>
            Task {run.index + 1} of {total}
          </Trans>
        </Kicker>
        <p className="text-title font-semibold">{task.instruction}</p>
        <Actions>
          <Button
            variant="primary"
            onClick={() => {
              if (startPath !== undefined) router.history.push(startPath);
            }}
          >
            <Trans>Back to the task</Trans>
          </Button>
        </Actions>
      </Page>
    );
  }

  return (
    <Page>
      <Kicker>
        <Trans>
          Task {run.index + 1} of {total}
        </Trans>
      </Kicker>
      <h1 className="text-title font-semibold" data-testid="study-goal-big">
        {task.instruction}
      </h1>
      <p className="text-body-sm text-fg-dim">
        <Trans>The goal stays at the bottom of the screen while you work.</Trans>
      </p>
      {startPath === undefined && lookup.state === "missing" ? (
        <p role="status" className="text-body-sm text-danger" data-testid="study-start-blocked">
          <Trans>
            Start task is off because no project is prepared for the code{" "}
            <span className="font-mono">{run.code}</span>. Ask the moderator to prepare the
            participant in the study console.
          </Trans>
        </p>
      ) : null}
      <Actions>
        <Button
          variant="primary"
          size="lg"
          disabled={left > 0 || startPath === undefined}
          onClick={start}
        >
          {left > 0 ? <Trans>Start task ({left})</Trans> : <Trans>Start task</Trans>}
        </Button>
      </Actions>
    </Page>
  );
}

function TaskReview({
  run,
  session,
  success,
  last,
}: {
  run: ParticipantRun;
  session: StudySession;
  success: boolean;
  last: boolean;
}) {
  const { i18n } = useLingui();
  const questionId = useId();
  const record = session.tasks?.[session.tasks.length - 1];
  const [seq, setSeq] = useState<number | null>(record?.seq ?? null);
  const [notes, setNotes] = useState<TaskNotes>(record?.notes ?? {});

  const next = () => {
    if (seq === null || record === undefined) return;
    const trimmed = Object.fromEntries(
      taskNoteKeys
        .map((key) => [key, (notes[key] ?? "").trim()] as const)
        .filter(([, value]) => value !== ""),
    ) as TaskNotes;
    updateStudy((state) => answerTask(state, session.id, record.id, seq, trimmed));
    writeRun(
      last
        ? { ...run, phase: "final", finalStep: 0, index: run.index + 1 }
        : { ...run, phase: "intro", index: run.index + 1 },
    );
  };

  return (
    <Page>
      <p className="font-semibold text-good" data-testid="study-review-head">
        {success ? <Trans>Task complete</Trans> : <Trans>Thank you for telling us</Trans>}
      </p>
      <h1 id={questionId} className="text-title font-semibold">
        {i18n._(seqQuestion)}
      </h1>
      <RatingScale
        count={7}
        value={seq}
        onChange={setSeq}
        labelledBy={questionId}
        low={`1 ${i18n._(seqEnds.low)}`}
        high={`7 ${i18n._(seqEnds.high)}`}
        testId="study-seq"
      />
      <div className="grid gap-3">
        <p className="text-body-sm text-fg-dim">
          <Trans>
            Optional. Say it to the moderator or type it here. Skip what you have nothing to say
            about.
          </Trans>
        </p>
        {taskNoteKeys.map((key) => (
          <NoteField
            key={key}
            label={i18n._(taskNoteLabels[key])}
            value={notes[key] ?? ""}
            onChange={(value) => setNotes((before) => ({ ...before, [key]: value }))}
          />
        ))}
      </div>
      <Actions>
        <Button variant="primary" disabled={seq === null} onClick={next}>
          {last ? <Trans>Continue</Trans> : <Trans>Next task</Trans>}
        </Button>
      </Actions>
    </Page>
  );
}

function NoteField({
  label,
  value,
  onChange,
  rows = 2,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={rows}
        maxLength={2000}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

const finalStepNames = ["sus", ...finalTextKeys] as const;

const finalSteps = finalStepNames.length;

function FinalBlock({ run, session }: { run: ParticipantRun; session: StudySession }) {
  const { i18n } = useLingui();
  const saved = session.final ?? emptyFinal();
  const step = Math.min(run.finalStep, finalSteps - 1);
  const textKey: FinalTextKey | undefined = step === 0 ? undefined : finalTextKeys[step - 1];
  const [sus, setSus] = useState<(number | null)[]>(saved.sus);
  const [text, setText] = useState(textKey === undefined ? "" : (saved.open[textKey] ?? ""));
  const [unanswered, setUnanswered] = useState<number[]>([]);
  const titleId = useId();

  const save = () => {
    const at = stamp();
    updateStudy((state) =>
      answerFinal(
        state,
        session.id,
        textKey === undefined ? { sus } : { open: { [textKey]: text.trim() } },
        at,
      ),
    );
  };

  const next = () => {
    if (step === 0) {
      const open = sus.flatMap((value, index) => (value === null ? [index + 1] : []));
      if (open.length > 0) {
        setUnanswered(open);
        return;
      }
    }
    save();
    if (step + 1 >= finalSteps) {
      updateStudy((state) => finishFinal(state, session.id, stamp()));
      writeRun({ ...run, phase: "done" });
      return;
    }
    writeRun({ ...run, finalStep: step + 1 });
  };

  const back = () => {
    save();
    writeRun({ ...run, finalStep: step - 1 });
  };

  return (
    <Page wide>
      <Kicker>
        <Trans>Last questions</Trans>
      </Kicker>
      <div className="flex gap-1" aria-hidden="true">
        {finalStepNames.map((name, index) => (
          <i
            key={name}
            className={`h-1 flex-1 rounded-full ${index <= step ? "bg-accent" : "bg-line"}`}
          />
        ))}
      </div>
      {textKey === undefined ? (
        <>
          <h1 className="text-title font-semibold">
            <Trans>A few questions about the whole experience</Trans>
          </h1>
          <p className="text-body text-fg-dim">
            <Trans>For each statement, pick how much you agree. Go with your first reaction.</Trans>
          </p>
          <ol className="grid gap-4" data-testid="study-sus">
            {susItems.map((item, index) => (
              <li key={item.id} className="grid gap-1.5">
                <span id={`${titleId}-sus${index}`} className="text-body text-fg">
                  {index + 1}. {i18n._(item)}
                </span>
                <RatingScale
                  count={5}
                  value={sus[index] ?? null}
                  onChange={(value) =>
                    setSus((before) => before.map((old, at) => (at === index ? value : old)))
                  }
                  labelledBy={`${titleId}-sus${index}`}
                  low={i18n._(susEnds.low)}
                  high={i18n._(susEnds.high)}
                />
              </li>
            ))}
          </ol>
          {unanswered.length === 0 ? null : (
            <p role="alert" className="text-body-sm text-danger">
              <Trans>Please answer statement {unanswered.join(", ")}.</Trans>
            </p>
          )}
        </>
      ) : (
        <div className="grid gap-2">
          <h1 id={titleId} className="text-title font-semibold">
            {i18n._(finalQuestions[textKey].title)}
          </h1>
          <p className="text-body-sm text-fg-dim">{i18n._(finalQuestions[textKey].hint)}</p>
          <Textarea
            aria-labelledby={titleId}
            rows={5}
            maxLength={2000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
      )}
      <Actions>
        {step === 0 ? null : (
          <Button onClick={back}>
            <Trans>Back</Trans>
          </Button>
        )}
        <Button variant="primary" onClick={next}>
          {step + 1 >= finalSteps ? <Trans>Finish</Trans> : <Trans>Next</Trans>}
        </Button>
      </Actions>
    </Page>
  );
}

function Thanks() {
  return (
    <Page>
      <h1 className="text-page-title font-semibold">
        <Trans>Thank you!</Trans>
      </h1>
      <p className="text-body text-fg">
        <Trans>Your answers are saved. You can close this tab now.</Trans>
      </p>
      <Actions>
        <Button variant="ghost" onClick={() => writeRun(freshRun())}>
          <Trans>Start the next participant</Trans>
        </Button>
      </Actions>
    </Page>
  );
}
