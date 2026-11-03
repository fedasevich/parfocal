import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildTrace,
  doubleClickRecord,
  finishGesture,
  gestureRecord,
  type Moment,
  momentAt,
  pointerRecord,
  timingFromSearch,
  traceFileBody,
  traceFileName,
  wheelRecord,
} from "./recording.ts";
import { type DeviceProfile, deviceProfiles } from "./steps.ts";
import type { InputTrace, TraceEvent, TraceGesture, TraceGestureEvent } from "./trace-format.ts";

interface Session {
  readonly profile: DeviceProfile;
  readonly index: number;
  readonly gestures: readonly (TraceGesture | null)[];
  readonly viewport: InputTrace["viewport"] | null;
}

const tickMs = 50;
const safariGestureTypes = ["gesturestart", "gesturechange", "gestureend"] as const;
const pointerTypes = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;

function download(trace: InputTrace) {
  const blob = new Blob([traceFileBody(trace)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = traceFileName(trace);
  link.click();
  URL.revokeObjectURL(link.href);
}

function StepList({ profile }: { profile: DeviceProfile }) {
  return (
    <ol className="grid list-decimal gap-1 pl-6 text-fg-2">
      {profile.steps.map((step) => (
        <li key={step.id}>
          <span className="text-fg">{step.title}.</span> {step.instruction}
        </li>
      ))}
    </ol>
  );
}

export function InputTraces() {
  const timing = useMemo(() => timingFromSearch(window.location.search), []);
  const [session, setSession] = useState<Session | null>(null);
  const [finished, setFinished] = useState(false);
  const [moment, setMoment] = useState<Moment>({ kind: "countdown", remainingMs: 0 });
  const [count, setCount] = useState(0);
  const [deviceName, setDeviceName] = useState("");
  const sessionRef = useRef<Session | null>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);
  const events = useRef<TraceEvent[]>([]);
  const gestureEvents = useRef<TraceGestureEvent[]>([]);

  const restartStep = useCallback(() => {
    startedAt.current = performance.now();
    events.current = [];
    gestureEvents.current = [];
    setCount(0);
    setMoment({ kind: "countdown", remainingMs: timing.countdownMs });
  }, [timing]);

  const finishStep = useCallback(() => {
    const current = sessionRef.current;
    if (current === null) return;
    const step = current.profile.steps[current.index];
    if (step === undefined) return;
    const box = padRef.current?.getBoundingClientRect();
    const next: Session = {
      ...current,
      index: current.index + 1,
      gestures: [...current.gestures, finishGesture(step, events.current, gestureEvents.current)],
      viewport:
        current.viewport ??
        (box === undefined
          ? null
          : { left: box.left, top: box.top, width: box.width, height: box.height }),
    };
    sessionRef.current = next;
    setSession(next);
    if (next.index >= next.profile.steps.length) {
      setFinished(true);
      return;
    }
    restartStep();
  }, [restartStep]);

  const begin = (profile: DeviceProfile) => {
    const first: Session = { profile, index: 0, gestures: [], viewport: null };
    sessionRef.current = first;
    setSession(first);
    setFinished(false);
    restartStep();
  };

  const leave = () => {
    sessionRef.current = null;
    setSession(null);
    setFinished(false);
  };

  const running = session !== null && !finished;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const next = momentAt(performance.now() - startedAt.current, timing);
      if (next.kind === "finished") finishStep();
      else setMoment(next);
    }, tickMs);
    return () => window.clearInterval(id);
  }, [running, timing, finishStep]);

  useEffect(() => {
    const pad = padRef.current;
    if (!running || pad === null) return;
    const recording = () =>
      momentAt(performance.now() - startedAt.current, timing).kind === "recording";
    const keep = (record: TraceEvent) => {
      events.current.push(record);
      setCount(events.current.length + gestureEvents.current.length);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (recording()) keep(wheelRecord(event));
    };
    const onPointer = (event: PointerEvent) => {
      const type = event.type as (typeof pointerTypes)[number];
      if (type === "pointerdown") {
        try {
          pad.setPointerCapture(event.pointerId);
        } catch {
          return;
        }
      }
      if (!recording()) return;
      if (type === "pointermove" && event.buttons === 0) return;
      keep(pointerRecord(type, event));
    };
    const onDoubleClick = (event: MouseEvent) => {
      event.preventDefault();
      if (recording()) keep(doubleClickRecord(event));
    };
    const onGesture = (event: Event) => {
      event.preventDefault();
      if (!recording()) return;
      const source = event as Event & MouseEvent & { scale: number; rotation: number };
      gestureEvents.current.push(
        gestureRecord(event.type as (typeof safariGestureTypes)[number], source),
      );
      setCount(events.current.length + gestureEvents.current.length);
    };
    const swallow = (event: Event) => event.preventDefault();
    pad.addEventListener("wheel", onWheel, { passive: false });
    pad.addEventListener("dblclick", onDoubleClick);
    for (const type of pointerTypes) pad.addEventListener(type, onPointer as EventListener);
    for (const type of safariGestureTypes) pad.addEventListener(type, onGesture);
    for (const type of ["mousedown", "auxclick", "contextmenu"])
      pad.addEventListener(type, swallow);
    return () => {
      pad.removeEventListener("wheel", onWheel);
      pad.removeEventListener("dblclick", onDoubleClick);
      for (const type of pointerTypes) pad.removeEventListener(type, onPointer as EventListener);
      for (const type of safariGestureTypes) pad.removeEventListener(type, onGesture);
      for (const type of ["mousedown", "auxclick", "contextmenu"]) {
        pad.removeEventListener(type, swallow);
      }
    };
  }, [running, timing]);

  const trace = (done: Session): InputTrace =>
    buildTrace(
      done.profile,
      done.gestures.filter((gesture): gesture is TraceGesture => gesture !== null),
      {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        viewport: done.viewport ?? { left: 0, top: 0, width: 0, height: 0 },
        deviceName,
      },
    );

  if (session === null) {
    return (
      <main className="grid max-w-3xl gap-6 p-8 text-fg">
        <h1 className="text-lg font-semibold">Input trace recorder</h1>
        <p className="text-fg-2">
          Each device has a short list of gestures. For every gesture the page names it, counts down{" "}
          {timing.countdownMs / 1000} seconds, records {timing.recordMs / 1000} seconds of raw
          wheel, pointer and gesture events over a pad and moves to the next one. At the end you
          download one JSON file for the device. Put it in{" "}
          <code>packages/viewer-engine/test/input/traces</code> and the replay tests pick it up. The
          file holds event types, deltas, positions, modifier keys and the user agent, nothing else.
        </p>
        <label className="grid gap-1">
          <span>Device name (optional, such as Logitech MX Master 3)</span>
          <input
            aria-label="Device name"
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
            className="rounded-md border border-line bg-chrome-2 px-2 py-1"
          />
        </label>
        {deviceProfiles.map((profile) => (
          <section
            key={profile.id}
            aria-label={profile.title}
            data-profile={profile.id}
            className="grid gap-2"
          >
            <h2 className="font-semibold">
              {profile.title}
              {profile.optional ? " (optional)" : ""}
            </h2>
            <p className="text-fg-2">
              {profile.summary} {profile.steps.length} steps, about{" "}
              {Math.ceil((profile.steps.length * (timing.countdownMs + timing.recordMs)) / 60_000)}{" "}
              minutes.
            </p>
            <StepList profile={profile} />
            <div>
              <button
                type="button"
                onClick={() => begin(profile)}
                className="rounded-md border border-line bg-chrome-2 px-3 py-1"
              >
                Start {profile.title}
              </button>
            </div>
          </section>
        ))}
      </main>
    );
  }

  if (finished) {
    return (
      <main className="grid max-w-3xl gap-4 p-8 text-fg">
        <h1 className="text-lg font-semibold">{session.profile.title} recorded</h1>
        <ul aria-label="Recorded steps" className="grid gap-1 font-mono text-sm">
          {session.profile.steps.map((step, index) => {
            const gesture = session.gestures[index];
            const total = (gesture?.events.length ?? 0) + (gesture?.gestureEvents?.length ?? 0);
            return (
              <li key={step.id} data-step={step.id} data-events={total}>
                {step.title}: {total === 0 ? "no events, run it again" : `${total} events`}
              </li>
            );
          })}
        </ul>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => download(trace(session))}
            disabled={session.gestures.every((gesture) => gesture === null)}
            className="rounded-md border border-line bg-chrome-2 px-3 py-1"
          >
            Download JSON
          </button>
          <button
            type="button"
            onClick={() => begin(session.profile)}
            className="rounded-md border border-line bg-chrome-2 px-3 py-1"
          >
            Record again
          </button>
          <button
            type="button"
            onClick={leave}
            className="rounded-md border border-line bg-chrome-2 px-3 py-1"
          >
            Back to the devices
          </button>
        </div>
      </main>
    );
  }

  const step = session.profile.steps[session.index];
  const seconds = (milliseconds: number) => (milliseconds / 1000).toFixed(1);
  const progress = moment.kind === "recording" ? moment.elapsedMs / timing.recordMs : 0;
  return (
    <main className="grid max-w-3xl gap-4 p-8 text-fg">
      <h1 className="text-lg font-semibold">
        {session.profile.title}, step {session.index + 1} of {session.profile.steps.length}
      </h1>
      <h2 className="font-semibold">{step?.title}</h2>
      <p className="text-fg-2">{step?.instruction}</p>
      <output
        aria-label="Recorder status"
        data-phase={moment.kind}
        data-step={step?.id ?? ""}
        data-index={session.index}
        data-events={count}
        className="grid gap-1 font-mono text-sm"
      >
        <span>
          {moment.kind === "countdown"
            ? `Get ready: ${Math.ceil(moment.remainingMs / 1000)}`
            : moment.kind === "recording"
              ? `Recording: ${seconds(moment.remainingMs)} s left, ${count} events`
              : "Saving"}
        </span>
        <progress value={progress} max={1} className="w-full" aria-label="Recording progress" />
      </output>
      <div
        ref={padRef}
        data-armed={moment.kind === "recording"}
        className="grid h-80 w-full touch-none select-none place-items-center rounded-lg border border-line bg-chrome-2 data-[armed=true]:border-fg"
      >
        {moment.kind === "recording" ? "Recording, go ahead" : "Keep the pointer over this pad"}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={finishStep}
          className="rounded-md border border-line bg-chrome-2 px-3 py-1"
        >
          Next step
        </button>
        <button
          type="button"
          onClick={leave}
          className="rounded-md border border-line bg-chrome-2 px-3 py-1"
        >
          Cancel
        </button>
      </div>
    </main>
  );
}
