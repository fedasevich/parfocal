import { Trans, useLingui } from "@lingui/react/macro";
import { useGetMyHome, useListMySlides } from "@parfocal/api-client";
import { useEffect, useRef, useState } from "react";
import { now } from "../clock.ts";
import { okData } from "../screens/placeholder.tsx";
import {
  checkMet,
  currentRound,
  durationSeconds,
  editTasks,
  isFrozen,
  nextTask,
  type Outcome,
  type PageProbe,
  recordResult,
  resolveStartPath,
  type StudyContext,
  startNextRound,
  startSession,
  summariseRound,
} from "./study-model.ts";
import { readStudy, writeStudy } from "./study-storage.ts";

const stamp = () => now().getTime();

const timerText = (seconds: number, target: number | undefined): string =>
  target === undefined ? `${seconds}s` : `${seconds}s / ${target}s`;

const taskWindowName = "parfocal-study-task";

const documentOf = (target: Window | null): Document | undefined => {
  try {
    return target?.document;
  } catch {
    return undefined;
  }
};

const probeOf = (target: Window | null): PageProbe | undefined => {
  try {
    if (target === null || target.closed) return undefined;
    const { document: page, location } = target;
    return {
      url: `${location.pathname}${location.search}`,
      count: (selector) => page.querySelectorAll(selector).length,
      text: () => page.body?.innerText ?? "",
    };
  } catch {
    return undefined;
  }
};

function useStudyContext(): StudyContext {
  const slides = okData(useListMySlides().data)?.slides ?? [];
  const resume = okData(useGetMyHome().data)?.resume ?? null;
  return {
    slides,
    resume:
      resume === null
        ? null
        : { projectId: resume.project.id, slideId: resume.slide_id, taskId: resume.task_id },
  };
}

export function StudyScreen() {
  const { t } = useLingui();
  const [state, setState] = useState(() => readStudy());
  const round = currentRound(state);
  const frozen = isFrozen(state, round.number);
  const [draft, setDraft] = useState(() => JSON.stringify(round.tasks, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [participant, setParticipant] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [taskStart, setTaskStart] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const context = useStudyContext();
  const taskWindow = useRef<Window | null>(null);
  const staleDocument = useRef<Document | undefined>(undefined);

  useEffect(() => {
    if (taskStart === null) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [taskStart]);

  const commit = (next: typeof state) => {
    setState(next);
    writeStudy(next);
  };

  const active = state.sessions.find((session) => session.id === activeId);
  const current = active === undefined ? undefined : nextTask(round, active);
  const elapsed = taskStart === null ? 0 : Math.max(0, Math.round((stamp() - taskStart) / 1000));
  const startPath = current === undefined ? undefined : resolveStartPath(current, context);

  const begin = () => {
    const name = participant.trim();
    if (name === "") return;
    const id = `s${state.sessions.length + 1}-${stamp()}`;
    commit(startSession(state, name, id, stamp()));
    setActiveId(id);
    setTaskStart(null);
    setParticipant("");
  };

  const finish = (outcome: Outcome, auto = false) => {
    if (active === undefined || current === undefined || taskStart === null) return;
    commit(
      recordResult(state, active.id, {
        taskId: current.id,
        startedAt: taskStart,
        endedAt: stamp(),
        outcome,
        ...(auto ? { auto } : {}),
      }),
    );
    setTaskStart(null);
  };

  const startTask = () => {
    setTaskStart(stamp());
    if (startPath === undefined) return;
    taskWindow.current = window.open(startPath, taskWindowName);
    staleDocument.current = documentOf(taskWindow.current);
  };

  useEffect(() => {
    if (taskStart === null || current?.check === undefined) return;
    if (documentOf(taskWindow.current) === staleDocument.current) return;
    const page = probeOf(taskWindow.current);
    if (page !== undefined && checkMet(current, context, page)) finish("done", true);
  });
  void tick;

  const saveTasks = () => {
    const result = editTasks(state, round.number, draft);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    commit(result.state);
  };

  const nextRound = () => {
    const next = startNextRound(state);
    commit(next);
    setDraft(JSON.stringify(currentRound(next).tasks, null, 2));
    setActiveId(null);
    setTaskStart(null);
  };

  const summary = summariseRound(state, round.number);

  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-8" data-testid="study-screen">
      <header className="grid gap-1">
        <h1 className="font-semibold text-page-title text-fg">
          <Trans>Study mode</Trans>
        </h1>
        <p className="text-body text-fg-dim" data-testid="study-round" data-frozen={frozen}>
          {frozen ? (
            <Trans>
              Round {round.number}. Its screens and tasks are frozen so sessions compare.
            </Trans>
          ) : (
            <Trans>Round {round.number}. No session has run yet, so the tasks can change.</Trans>
          )}
        </p>
      </header>

      <section className="grid gap-3" aria-label={t`Run a session`}>
        <h2 className="font-semibold text-fg">
          <Trans>Run a session</Trans>
        </h2>
        {current === undefined || active === undefined ? (
          <div className="flex gap-2">
            <input
              className="rounded border border-line bg-surface px-2 py-1 text-fg"
              aria-label={t`Participant code`}
              value={participant}
              onChange={(event) => setParticipant(event.target.value)}
              placeholder={t`P1`}
            />
            <button
              type="button"
              className="rounded border border-line px-3 py-1 text-fg"
              onClick={begin}
            >
              <Trans>Start session</Trans>
            </button>
            {active === undefined ? null : (
              <span className="self-center text-fg-dim" data-testid="study-session-finished">
                <Trans>Session {active.participant} finished.</Trans>
              </span>
            )}
          </div>
        ) : (
          <div className="grid gap-2 rounded border border-line p-4" data-testid="study-task-card">
            <p className="text-body-sm text-fg-dim">
              {active.participant}
              {" · "}
              {active.results.length + 1}/{round.tasks.length}
            </p>
            <h3 className="font-semibold text-fg">{current.title}</h3>
            <p className="text-fg">{current.instruction}</p>
            <p className="font-mono text-fg" data-testid="study-timer">
              {timerText(taskStart === null ? 0 : elapsed, current.targetSeconds)}
            </p>
            <div className="flex gap-2">
              {taskStart === null ? (
                <>
                  <button
                    type="button"
                    className="rounded border border-line px-3 py-1 text-fg"
                    onClick={startTask}
                  >
                    <Trans>Start task</Trans>
                  </button>
                  <button
                    type="button"
                    className="rounded border border-line px-3 py-1 text-fg"
                    onClick={() => {
                      commit(
                        recordResult(state, active.id, {
                          taskId: current.id,
                          startedAt: stamp(),
                          endedAt: stamp(),
                          outcome: "skipped",
                        }),
                      );
                    }}
                  >
                    <Trans>Skip</Trans>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="rounded border border-line px-3 py-1 text-fg"
                    onClick={() => finish("done")}
                  >
                    <Trans>Done</Trans>
                  </button>
                  <button
                    type="button"
                    className="rounded border border-line px-3 py-1 text-fg"
                    onClick={() => finish("gave-up")}
                  >
                    <Trans>Gave up</Trans>
                  </button>
                </>
              )}
              {startPath === undefined ? null : (
                <a
                  className="rounded border border-line px-3 py-1 text-fg"
                  href={startPath}
                  target={taskWindowName}
                  onClick={(event) => {
                    event.preventDefault();
                    taskWindow.current = window.open(startPath, taskWindowName);
                  }}
                >
                  <Trans>Open start screen</Trans>
                </a>
              )}
            </div>
            {current.check === undefined ? null : (
              <p className="text-body-sm text-fg-dim" data-testid="study-auto-check">
                <Trans>Ends by itself when the task screen shows the goal.</Trans>
              </p>
            )}
          </div>
        )}
      </section>

      <section className="grid gap-2" aria-label={t`Results`}>
        <h2 className="font-semibold text-fg">
          <Trans>Results for this round</Trans>
        </h2>
        <table className="w-full text-body" data-testid="study-summary">
          <thead>
            <tr className="text-left text-body-sm text-fg-dim">
              <th className="py-2">
                <Trans>Task</Trans>
              </th>
              <th>
                <Trans>Answered</Trans>
              </th>
              <th>
                <Trans>Done</Trans>
              </th>
              <th>
                <Trans>Median seconds</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {round.tasks.map((task, index) => (
              <tr
                key={task.id}
                className="border-t border-line"
                data-testid={`study-row-${task.id}`}
              >
                <td className="py-2 text-fg">{task.title}</td>
                <td className="font-mono">{summary[index]?.sessions ?? 0}</td>
                <td className="font-mono">{summary[index]?.completed ?? 0}</td>
                <td className="font-mono">{summary[index]?.medianSeconds ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="text-body-sm text-fg-dim">
          {state.sessions
            .filter((session) => session.round === round.number)
            .map((session) => (
              <li key={session.id}>
                {session.participant}
                {": "}
                {session.results
                  .map(
                    (result) =>
                      `${result.taskId} ${durationSeconds(result)}s ${result.outcome}${result.auto ? " (auto)" : ""}`,
                  )
                  .join(", ")}
              </li>
            ))}
        </ul>
        <button
          type="button"
          className="w-fit rounded border border-line px-3 py-1 text-fg"
          onClick={() => {
            const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `study-round-${round.number}.json`;
            link.click();
            URL.revokeObjectURL(link.href);
          }}
        >
          <Trans>Download results</Trans>
        </button>
      </section>

      <section className="grid gap-2" aria-label={t`Task set`}>
        <h2 className="font-semibold text-fg">
          <Trans>Task set</Trans>
        </h2>
        <textarea
          className="min-h-64 rounded border border-line bg-surface p-2 font-mono text-body-sm text-fg"
          aria-label={t`Task set JSON`}
          value={draft}
          readOnly={frozen}
          onChange={(event) => setDraft(event.target.value)}
        />
        {error === null ? null : (
          <p role="alert" className="text-danger" data-testid="study-error">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-fg"
            onClick={saveTasks}
          >
            <Trans>Save tasks</Trans>
          </button>
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-fg"
            onClick={nextRound}
          >
            <Trans>Start next round</Trans>
          </button>
        </div>
      </section>
    </main>
  );
}
