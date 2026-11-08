import type { UploadState } from "@parfocal/api-client";

export type StepRow = { label: string; detail: string };

export type SlideSteps = {
  rows: StepRow[];
  done: number;
  running: boolean;
  skipped: boolean;
  failed: boolean;
  finished: boolean;
  openable: boolean;
};

export type SlideStepsInput = {
  uploaded: boolean;
  state: Pick<UploadState, "status" | "step"> | undefined;
  hasResults: boolean;
};

const stepIndexOf = (step: string | null): number => {
  const name = (step ?? "").toLowerCase();
  if (/place|object|id/.test(name)) return 4;
  if (/result/.test(name)) return 3;
  if (/tissue|mask/.test(name)) return 2;
  return 1;
};

export function slideSteps({ uploaded, state, hasResults }: SlideStepsInput): SlideSteps {
  const rows: StepRow[] = [
    { label: "Uploaded", detail: "" },
    { label: "Tiles built", detail: "" },
    { label: "Tissue found", detail: "" },
    hasResults
      ? { label: "Results read", detail: "" }
      : { label: "No results", detail: "This slide came without any" },
    { label: "Placed on the slide and IDs given", detail: "" },
  ];
  const status = state?.status;
  if (status === "skipped") {
    return {
      rows: [],
      done: 0,
      running: false,
      skipped: true,
      failed: false,
      finished: false,
      openable: false,
    };
  }
  const finished = status === "ready";
  const failed = status === "failed";
  const done = finished
    ? rows.length
    : status === "processing"
      ? stepIndexOf(state?.step ?? null)
      : uploaded
        ? 1
        : 0;
  const running = !finished && !failed && status !== "waiting";
  return { rows, done, running, skipped: false, failed, finished, openable: done >= 3 };
}

export function minutesLeft(sent: number, total: number, elapsedMs: number): number | null {
  if (sent <= 0 || elapsedMs < 2_000 || sent >= total) return null;
  const bytesPerMs = sent / elapsedMs;
  return Math.max(1, Math.ceil((total - sent) / bytesPerMs / 60_000));
}

export const timeLeftText = (minutes: number | null) =>
  minutes === null ? "" : ` · about ${minutes} min left`;
