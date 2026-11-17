import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import {
  cursorAt,
  deadClicks,
  documentHtml,
  durationOf,
  hasFrames,
  recentClick,
  reloads,
  screenAt,
  type TraceEvent,
  taskSpans,
  wireframeAt,
} from "./trace-model.ts";

const stageWidth = 800;
const stepMs = 100;

export function ReplayPanel(props: { events: TraceEvent[]; titles: Record<string, string> }) {
  const { t } = useLingui();
  const { events, titles } = props;
  const total = durationOf(events);
  const framesPresent = hasFrames(events);
  const [pointerOnly, setPointerOnly] = useState(!framesPresent);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setTime((value) => {
        if (value + stepMs >= total) {
          setPlaying(false);
          return total;
        }
        return value + stepMs;
      });
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [playing, total]);

  const spans = useMemo(() => taskSpans(events), [events]);
  const dead = useMemo(() => deadClicks(events), [events]);
  const reloaded = useMemo(() => reloads(events), [events]);
  const screen = useMemo(() => screenAt(events, time), [events, time]);
  const wireframe = wireframeAt(events, time);
  const viewportWidth = screen.load?.w ?? wireframe.width;
  const viewportHeight = screen.load?.h ?? wireframe.height;
  const scale = stageWidth / viewportWidth;
  const html = useMemo(
    () => (pointerOnly ? "" : documentHtml(screen, window.location.origin)),
    [pointerOnly, screen.frame, screen.load, screen],
  );
  const atSeconds = Math.round(time / 1000);
  const totalSeconds = Math.round(total / 1000);
  const cursor = cursorAt(events, time);
  const click = recentClick(events, time);
  const percent = (value: number) => `${total === 0 ? 0 : (value / total) * 100}%`;

  return (
    <div className="grid gap-3 rounded border border-line p-4" data-testid="replay-panel">
      <div className="flex flex-wrap gap-2" data-testid="replay-chips">
        {spans.map((span) => (
          <button
            key={`${span.taskId}-${span.from}`}
            type="button"
            className="rounded border border-line px-2 py-1 text-body-sm text-fg"
            data-testid={`replay-chip-${span.taskId}`}
            onClick={() => setTime(span.from)}
          >
            {titles[span.taskId] ?? span.taskId}
          </button>
        ))}
      </div>

      <div
        className="relative h-6 rounded bg-surf-field"
        data-testid="replay-strip"
        data-dead-clicks={dead.length}
        data-reloads={reloaded.length}
      >
        {spans.map((span, index) => (
          <div
            key={`${span.taskId}-${span.from}`}
            className={`absolute top-0 h-full border-r border-line ${index % 2 === 0 ? "bg-surf-raised" : ""}`}
            style={{ left: percent(span.from), width: percent(span.to - span.from) }}
            data-testid={`replay-span-${span.taskId}`}
          />
        ))}
        {dead.map((at) => (
          <span
            key={`dead-${at}`}
            className="absolute top-0 h-full w-1 bg-danger"
            style={{ left: percent(at) }}
            data-testid="replay-dead-click"
          />
        ))}
        {reloaded.map((at) => (
          <span
            key={`reload-${at}`}
            className="absolute top-0 h-full w-1 bg-fg"
            style={{ left: percent(at) }}
            data-testid="replay-reload"
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-line px-3 py-1 text-fg"
          onClick={() => {
            if (time >= total) setTime(0);
            setPlaying((value) => !value);
          }}
        >
          {playing ? <Trans>Pause</Trans> : <Trans>Play</Trans>}
        </button>
        <input
          type="range"
          className="grow"
          aria-label={t`Replay position`}
          min={0}
          max={total}
          value={time}
          onChange={(event) => setTime(Number(event.target.value))}
        />
        <span className="font-mono text-body-sm text-fg-dim" data-testid="replay-time">
          <Trans>
            {atSeconds}s / {totalSeconds}s
          </Trans>
        </span>
        {framesPresent ? (
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-fg"
            onClick={() => setPointerOnly((value) => !value)}
          >
            {pointerOnly ? <Trans>Show screen</Trans> : <Trans>Pointer only</Trans>}
          </button>
        ) : null}
      </div>

      <div
        className="relative overflow-hidden rounded border border-line bg-surf-field"
        style={{ width: stageWidth, height: viewportHeight * scale }}
        data-testid="replay-stage"
        data-mode={pointerOnly ? "pointer-only" : "screen"}
        data-path={screen.path}
      >
        {pointerOnly ? (
          <div
            className="absolute inset-0 grid content-start gap-1 p-3"
            data-testid="replay-wireframe"
          >
            <p className="font-mono text-body-sm text-fg">{wireframe.path}</p>
            {wireframe.marks.map((mark) => (
              <span
                key={`${mark.x}-${mark.y}-${mark.target}`}
                className="absolute size-2 rounded-full bg-fg-dim"
                style={{ left: mark.x * scale, top: mark.y * scale }}
                title={mark.target}
              />
            ))}
          </div>
        ) : (
          <iframe
            title={t`Replay screen`}
            sandbox=""
            srcDoc={html}
            style={{
              width: viewportWidth,
              height: viewportHeight,
              transform: `scale(${scale})`,
              transformOrigin: "0 0",
              border: 0,
              pointerEvents: "none",
            }}
          />
        )}
        {cursor === undefined ? null : (
          <span
            className="absolute size-3 rounded-full bg-accent"
            style={{ left: cursor.x * scale, top: cursor.y * scale }}
            data-testid="replay-cursor"
          />
        )}
        {click === undefined ? null : (
          <span
            className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent"
            style={{ left: click.x * scale, top: click.y * scale }}
            data-testid="replay-click"
          />
        )}
      </div>
    </div>
  );
}
