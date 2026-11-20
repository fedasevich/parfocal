import type { RequestHandler } from "msw";
import {
  getGetTaskTimingMockHandler,
  getRecordTimingEventsMockHandler,
} from "../generated/api.msw.ts";
import type { RecordedTimingEvent, TimingEventBatch } from "../generated/api.ts";

const storageKey = "parfocal.fake.timing-events";
const kept = 5000;
let memory: RecordedTimingEvent[] = [];

function session(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

function readEvents(): RecordedTimingEvent[] {
  const stored = session()?.getItem(storageKey);
  return stored == null ? memory : (JSON.parse(stored) as RecordedTimingEvent[]);
}

function writeEvents(events: RecordedTimingEvent[]): void {
  memory = events;
  session()?.setItem(storageKey, JSON.stringify(events));
}

export function resetFakeTimingEvents(): void {
  memory = [];
  session()?.removeItem(storageKey);
}

export function timingHandlers(): RequestHandler[] {
  return [
    getRecordTimingEventsMockHandler(async ({ request }) => {
      const batch = (await request.json()) as TimingEventBatch;
      const recordedAt = new Date().toISOString();
      const added = batch.events.map((event) => ({ ...event, recorded_at: recordedAt }));
      writeEvents([...added.reverse(), ...readEvents()].slice(0, kept));
      return { recorded: added.length };
    }),
    getGetTaskTimingMockHandler(() => ({ events: readEvents() })),
  ];
}
