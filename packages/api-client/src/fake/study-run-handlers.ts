import type { RequestHandler } from "msw";
import {
  getGetStudyTraceMockHandler,
  getListStudySessionsMockHandler,
  getMarkStudyDryRunMockHandler,
  getPrepareStudyParticipantMockHandler,
  getRemoveStudyParticipantMockHandler,
  getSaveStudySessionMockHandler,
  getSaveStudyTracePartMockHandler,
} from "../generated/api.msw.ts";
import type {
  StudyDryRun,
  StudySessionRow,
  StudySessionUpload,
  StudyTracePart,
  StudyTraceUpload,
} from "../generated/api.ts";
import { tenant } from "./scenario-admin.ts";
import {
  fakeStudyProjectId,
  fakeStudyWorkspaceName,
  prepareFakeParticipant,
  removeFakeParticipant,
} from "./study-participant.ts";
import { activeFakeWorkspace } from "./workspace-scene.ts";

export const fakeStudyRunsKey = "parfocal.fake.study-runs";

type StoredSession = Omit<StudySessionRow, "trace_parts" | "answers"> & { answers_gz: string };

type StudyRunStore = { sessions: StoredSession[]; parts: Record<string, StudyTracePart[]> };

let memory: StudyRunStore = { sessions: [], parts: {} };

function local(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function readStore(): StudyRunStore {
  const stored = local()?.getItem(fakeStudyRunsKey);
  return stored == null ? memory : (JSON.parse(stored) as StudyRunStore);
}

function writeStore(store: StudyRunStore): void {
  memory = store;
  local()?.setItem(fakeStudyRunsKey, JSON.stringify(store));
}

export function resetFakeStudyRuns(): void {
  memory = { sessions: [], parts: {} };
  local()?.removeItem(fakeStudyRunsKey);
}

const bytesOf = (encoded: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));

async function gunzipJson(encoded: string): Promise<unknown> {
  const stream = new Blob([bytesOf(encoded)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as unknown;
}

const keyOf = (params: Record<string, unknown>): string => String(params.sessionKey);

const codeOf = (params: Record<string, unknown>): string => String(params.code).toUpperCase();

export function studyRunHandlers(): RequestHandler[] {
  return [
    getPrepareStudyParticipantMockHandler(({ params }) => {
      const code = codeOf(params);
      prepareFakeParticipant(code);
      return {
        code,
        project_id: fakeStudyProjectId,
        workspace_id: activeFakeWorkspace() ?? tenant.id,
        workspace_name: fakeStudyWorkspaceName,
      };
    }),
    getRemoveStudyParticipantMockHandler(({ params }) => {
      const code = codeOf(params);
      return { code, removed: removeFakeParticipant(code) };
    }),
    getSaveStudySessionMockHandler(async ({ request, params }) => {
      const upload = (await request.json()) as StudySessionUpload;
      const sessionKey = keyOf(params);
      const store = readStore();
      const known = store.sessions.find((row) => row.session_key === sessionKey);
      const row: StoredSession = {
        session_key: sessionKey,
        participant: upload.participant,
        round: upload.round,
        dry_run: known?.dry_run ?? false,
        answers_gz: upload.answers_gz,
        updated_at: new Date().toISOString(),
      };
      writeStore({
        ...store,
        sessions: known
          ? store.sessions.map((entry) => (entry === known ? row : entry))
          : [...store.sessions, row],
      });
      return { session_key: sessionKey };
    }),
    getSaveStudyTracePartMockHandler(async ({ request, params }) => {
      const upload = (await request.json()) as StudyTraceUpload;
      const sessionKey = keyOf(params);
      const seq = Number(params.seq);
      const store = readStore();
      const parts = store.parts[sessionKey] ?? [];
      if (!parts.some((part) => part.seq === seq)) {
        writeStore({
          ...store,
          parts: {
            ...store.parts,
            [sessionKey]: [...parts, { seq, events_gz: upload.events_gz }].sort(
              (a, b) => a.seq - b.seq,
            ),
          },
        });
      }
      return { session_key: sessionKey };
    }),
    getListStudySessionsMockHandler(async () => {
      const store = readStore();
      const sessions = await Promise.all(
        store.sessions.map(async ({ answers_gz, ...row }) => ({
          ...row,
          answers: (await gunzipJson(answers_gz)) as StudySessionRow["answers"],
          trace_parts: store.parts[row.session_key]?.length ?? 0,
        })),
      );
      return { sessions };
    }),
    getGetStudyTraceMockHandler(({ params }) => ({
      parts: readStore().parts[keyOf(params)] ?? [],
    })),
    getMarkStudyDryRunMockHandler(async ({ request, params }) => {
      const mark = (await request.json()) as StudyDryRun;
      const store = readStore();
      writeStore({
        ...store,
        sessions: store.sessions.map((row) =>
          row.session_key === keyOf(params) ? { ...row, dry_run: mark.dry_run } : row,
        ),
      });
      return mark;
    }),
  ];
}
