import { Trans, useLingui } from "@lingui/react/macro";
import {
  getListStudySessionsQueryKey,
  getStudyTrace,
  useListStudySessions,
  useMarkStudyDryRun,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { okData, QueryState } from "../screens/placeholder.tsx";
import { roundFourReported } from "./round-four.ts";
import {
  attemptsCsv,
  finalAnswers,
  fromServer,
  type MetricRow,
  notesByTask,
  participantTable,
  resultsJson,
  type ServerSession,
  susSummary,
  taskTable,
  thisRound,
} from "./study-results.ts";
import { gunzipBase64 } from "./study-upload.ts";
import { ReplayPanel } from "./trace/replay-panel.tsx";
import { mergeBatches, type TraceEvent } from "./trace/trace-model.ts";

const dash = "-";

const seconds = (ms: number | null): string => (ms === null ? dash : `${(ms / 1000).toFixed(1)} s`);

const decimal = (value: number | null, digits = 1): string =>
  value === null ? dash : value.toFixed(digits);

const percent = (part: number, whole: number): string =>
  whole === 0 ? dash : `${Math.round((part / whole) * 100)}%`;

const save = (name: string, type: string, text: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
};

const cell = "py-1.5 pr-3";
const button = "rounded border border-line px-3 py-1 text-fg";

function MetricTable(props: {
  rows: (MetricRow & { sus?: number | null })[];
  testId: string;
  first: ReactNode;
  sus?: boolean;
}) {
  const { rows, testId, first } = props;
  return (
    <table className="w-full text-body-sm" data-testid={testId}>
      <thead>
        <tr className="text-left text-fg-dim">
          <th className={cell}>{first}</th>
          <th className={cell}>
            <Trans>Success</Trans>
          </th>
          <th className={cell}>
            <Trans>Median time</Trans>
          </th>
          <th className={cell}>
            <Trans>Mean clicks</Trans>
          </th>
          <th className={cell}>
            <Trans>Dead clicks</Trans>
          </th>
          <th className={cell}>
            <Trans>Mean SEQ</Trans>
          </th>
          <th className={cell}>
            <Trans>First click correct</Trans>
          </th>
          <th className={cell}>
            <Trans>Time to first action</Trans>
          </th>
          <th className={cell}>
            <Trans>Path straightness</Trans>
          </th>
          {props.sus ? (
            <th className={cell}>
              <Trans>SUS</Trans>
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.key}
            className="border-t border-line font-mono"
            data-testid={`${testId}-row`}
          >
            <td className={`${cell} font-sans text-fg`}>{row.label}</td>
            <td className={cell} data-testid="success">
              {row.successes}/{row.attempts}
            </td>
            <td className={cell}>{seconds(row.medianDurationMs)}</td>
            <td className={cell}>{decimal(row.meanClicks)}</td>
            <td className={cell}>
              {row.deadClicks} ({percent(row.deadClicks, row.clicks)})
            </td>
            <td className={cell}>{decimal(row.meanSeq)}</td>
            <td className={cell}>
              {row.firstClickJudged === 0
                ? dash
                : `${row.firstClickCorrect}/${row.firstClickJudged}`}
            </td>
            <td className={cell}>{seconds(row.medianTimeToFirstActionMs)}</td>
            <td className={cell}>{decimal(row.meanPathStraightness, 2)}</td>
            {props.sus ? <td className={cell}>{decimal(row.sus ?? null)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NoteList({
  notes,
  label,
}: {
  notes: { participant: string; text: string }[];
  label: ReactNode;
}) {
  if (notes.length === 0) return null;
  return (
    <div className="grid gap-0.5">
      <p className="text-caption font-semibold text-fg-dim">{label}</p>
      <ul className="grid gap-0.5 text-body-sm text-fg">
        {notes.map((note) => (
          <li key={`${note.participant}-${note.text}`}>
            <span className="font-mono text-fg-dim">{note.participant}</span> {note.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoundCompare({ sessions }: { sessions: ServerSession[] }) {
  const now = thisRound(sessions);
  const four = roundFourReported;
  const rows: {
    key: string;
    label: ReactNode;
    four: string;
    now: string;
    differs?: ReactNode;
  }[] = [
    {
      key: "completed",
      label: <Trans>Tasks completed</Trans>,
      four: `${four.tasksCompleted} of ${four.tasksAttempted}`,
      now: `${now.tasksCompleted} of ${now.tasksAttempted}`,
    },
    {
      key: "seq",
      label: <Trans>Mean SEQ of 7</Trans>,
      four: `${four.meanSeq}`,
      now: decimal(now.meanSeq),
    },
    {
      key: "seq-high",
      label: <Trans>Tasks rated 6 or 7</Trans>,
      four: `${four.seqSixOrSeven} of ${four.seqRated}`,
      now: `${now.seqSixOrSeven} of ${now.seqRated}`,
    },
    {
      key: "seq-low",
      label: <Trans>Tasks rated below 4</Trans>,
      four: `${four.seqBelowFour}`,
      now: `${now.seqBelowFour}`,
    },
    {
      key: "sus",
      label: <Trans>Mean SUS</Trans>,
      four: `${four.meanSus}`,
      now: decimal(now.meanSus),
    },
    {
      key: "sus-each",
      label: <Trans>SUS per participant</Trans>,
      four: four.susByParticipant.map((row) => `${row.participant} ${row.score}`).join(", "),
      now: now.susByParticipant.map((row) => `${row.participant} ${row.score}`).join(", ") || dash,
    },
    {
      key: "dead",
      label: <Trans>Dead clicks</Trans>,
      four: `${four.deadClickPercent}% (${four.deadClicks} of ${four.clicks})`,
      now: `${percent(now.deadClicks, now.clicks)} (${now.deadClicks} of ${now.clicks})`,
      differs: (
        <Trans>
          Both count a click in the app on nothing that reacts, but this round judges it by whether
          the page changed within 800 ms and skips drags, where round 4 listed which mock elements
          could be clicked.
        </Trans>
      ),
    },
    {
      key: "silent",
      label: <Trans>Control presses with no change, the earlier round 5 rule</Trans>,
      four: dash,
      now: `${now.silentControlClicks} of ${now.clicks}`,
      differs: <Trans>Round 4 did not measure this.</Trans>,
    },
    {
      key: "first-action",
      label: <Trans>Median time to first action</Trans>,
      four: `${four.medianTimeToFirstActionSeconds} s`,
      now: seconds(now.medianTimeToFirstActionMs),
      differs: (
        <Trans>
          Both run from the task start to the first click or key that does something, but this round
          counts a key only when the page changed after it.
        </Trans>
      ),
    },
    {
      key: "first-input",
      label: <Trans>Median time to first input, the earlier round 5 rule</Trans>,
      four: dash,
      now: seconds(now.medianTimeToFirstInputMs),
      differs: <Trans>Round 4 did not measure this.</Trans>,
    },
  ];
  return (
    <section className="grid gap-2" data-testid="study-round-compare">
      <h3 className="font-semibold text-fg">
        <Trans>Round 4 against this round</Trans>
      </h3>
      <p className="text-body-sm text-fg-dim">
        <Trans>
          Round 4 figures are the ones its deck reported, quoted as they are. Round 1 reported a
          mean SUS of {four.roundOneSus}. This round counts every session that is not a dry run.
        </Trans>
      </p>
      <table className="w-full text-body-sm">
        <thead>
          <tr className="text-left text-fg-dim">
            <th className={cell}>
              <Trans>Measure</Trans>
            </th>
            <th className={cell}>
              <Trans>Round 4, reported</Trans>
            </th>
            <th className={cell}>
              <Trans>This round</Trans>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-line" data-testid={`compare-${row.key}`}>
              <td className={`${cell} text-fg`}>
                {row.label}
                {row.differs === undefined ? null : (
                  <span className="block text-caption text-fg-dim" data-testid="compare-differs">
                    {row.differs}
                  </span>
                )}
              </td>
              <td className={`${cell} font-mono`} data-testid="round-four">
                {row.four}
              </td>
              <td className={`${cell} font-mono`} data-testid="this-round">
                {row.now}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function StudyResultsPanel({ titles }: { titles: Record<string, string> }) {
  const { t } = useLingui();
  const listing = useListStudySessions();
  const queryClient = useQueryClient();
  const marking = useMarkStudyDryRun({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListStudySessionsQueryKey() }),
    },
  });
  const [replay, setReplay] = useState<{ key: string; events: TraceEvent[] } | null>(null);
  const sessions = (okData(listing.data)?.sessions ?? []).map(fromServer);
  const included = sessions.filter((entry) => !entry.dryRun);
  const sus = susSummary(sessions);
  const notes = notesByTask(sessions);
  const finals = finalAnswers(sessions);
  const replayTitles = {
    ...titles,
    ...Object.fromEntries(taskTable(sessions).map((row) => [row.key, row.label])),
  };

  const showReplay = async (key: string) => {
    const trace = okData(await getStudyTrace(key));
    const batches = await Promise.all(
      (trace?.parts ?? []).map(async (part) => ({
        sessionId: key,
        index: part.seq,
        events: (await gunzipBase64(part.events_gz)) as TraceEvent[],
      })),
    );
    setReplay({ key, events: mergeBatches(batches) });
  };

  return (
    <section className="grid gap-4" aria-label={t`Uploaded results`} data-testid="study-results">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-fg">
          <Trans>Uploaded results</Trans>
        </h2>
        <span className="text-body-sm text-fg-dim" data-testid="study-results-count">
          <Trans>
            {included.length} sessions counted, {sessions.length - included.length} dry runs left
            out
          </Trans>
        </span>
        <button
          type="button"
          className={button}
          onClick={() => save("study-results.json", "application/json", resultsJson(sessions))}
        >
          <Trans>Export JSON</Trans>
        </button>
        <button
          type="button"
          className={button}
          onClick={() => save("study-attempts.csv", "text/csv", attemptsCsv(sessions))}
        >
          <Trans>Export CSV</Trans>
        </button>
      </header>
      <QueryState label={t`uploaded sessions`} isPending={listing.isPending} error={listing.error}>
        <ul className="grid gap-1 text-body-sm" data-testid="study-results-sessions">
          {sessions.map((entry) => (
            <li
              key={entry.key}
              className="flex flex-wrap items-center gap-3"
              data-testid={`study-result-${entry.participant}`}
              data-dry-run={entry.dryRun}
            >
              <span className="font-mono text-fg">{entry.participant}</span>
              <span className="text-fg-dim">
                <Trans>
                  Round {entry.round}, {entry.session?.tasks?.length ?? 0} tasks, {entry.traceParts}{" "}
                  trace parts
                </Trans>
              </span>
              <label className="flex items-center gap-1 text-fg">
                <input
                  type="checkbox"
                  checked={entry.dryRun}
                  disabled={marking.isPending}
                  onChange={(event) =>
                    marking.mutate({
                      sessionKey: entry.key,
                      data: { dry_run: event.target.checked },
                    })
                  }
                />
                <Trans>Dry run</Trans>
              </label>
              <button
                type="button"
                className="rounded border border-line px-2 py-0.5 text-fg"
                disabled={entry.traceParts === 0}
                onClick={() => void showReplay(entry.key)}
              >
                <Trans>Replay</Trans>
              </button>
            </li>
          ))}
        </ul>
        {replay === null ? null : (
          <ReplayPanel key={replay.key} events={replay.events} titles={replayTitles} />
        )}

        <h3 className="font-semibold text-fg">
          <Trans>Per task</Trans>
        </h3>
        <MetricTable rows={taskTable(sessions)} testId="study-results-tasks" first={t`Task`} />

        <h3 className="font-semibold text-fg">
          <Trans>Per participant</Trans>
        </h3>
        <MetricTable
          rows={participantTable(sessions)}
          testId="study-results-participants"
          first={t`Participant`}
          sus
        />

        <div className="grid gap-1" data-testid="study-results-sus">
          <h3 className="font-semibold text-fg">
            <Trans>SUS</Trans>
          </h3>
          <p className="font-mono text-body-sm text-fg">
            {sus.rows.map((row) => `${row.participant} ${row.score}`).join(", ") || dash}
          </p>
          <p className="text-body-sm text-fg" data-testid="study-results-sus-mean">
            <Trans>Mean {decimal(sus.mean)}</Trans>
          </p>
        </div>

        <div className="grid gap-3" data-testid="study-results-notes">
          <h3 className="font-semibold text-fg">
            <Trans>Notes by task</Trans>
          </h3>
          {notes.map((group) => (
            <div key={group.taskId} className="grid gap-1" data-testid={`notes-${group.taskId}`}>
              <p className="font-semibold text-body-sm text-fg">{group.title}</p>
              <NoteList notes={group.like} label={<Trans>Liked</Trans>} />
              <NoteList notes={group.dislike} label={<Trans>Disliked</Trans>} />
              <NoteList notes={group.recommend} label={<Trans>Recommended</Trans>} />
            </div>
          ))}
        </div>

        <div className="grid gap-2" data-testid="study-results-final">
          <h3 className="font-semibold text-fg">
            <Trans>Final open answers</Trans>
          </h3>
          {finals.map((row) => (
            <dl key={row.participant} className="grid grid-cols-[10rem_1fr] gap-x-3 text-body-sm">
              <dt className="font-mono text-fg-dim">{row.participant}</dt>
              <dd />
              <dt className="text-fg-dim">
                <Trans>Liked</Trans>
              </dt>
              <dd className="text-fg">{row.like || dash}</dd>
              <dt className="text-fg-dim">
                <Trans>Disliked</Trans>
              </dt>
              <dd className="text-fg">{row.dislike || dash}</dd>
              <dt className="text-fg-dim">
                <Trans>Expected but missing</Trans>
              </dt>
              <dd className="text-fg">{row.missing || dash}</dd>
              <dt className="text-fg-dim">
                <Trans>Recommended</Trans>
              </dt>
              <dd className="text-fg">{row.recommend || dash}</dd>
            </dl>
          ))}
        </div>

        <RoundCompare sessions={sessions} />
      </QueryState>
    </section>
  );
}
