import { Trans, useLingui } from "@lingui/react/macro";
import { type ModelRunDraft, startModelRuns } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { useState } from "react";
import { useDocked } from "./inspector-slots.tsx";
import {
  buildRunDraft,
  defaultRunOptions,
  type RunOptions,
  type RunScopeChoice,
  type ViewRect,
} from "./run-options.ts";

type StartRunPanelProps = {
  readonly projectId: string;
  readonly slideId: string;
  readonly currentView: () => ViewRect | null;
  readonly selection: ViewRect | null;
  readonly canTune: boolean;
  readonly taskId?: string | null;
  readonly onStarted: (runIds: readonly string[]) => void;
  readonly onLoadLast: () => Promise<boolean>;
};

type Notice = "none" | "failed" | "no-run" | "no-view";

function Notices({ notice }: { notice: Notice }) {
  if (notice === "failed") return <Trans>The run could not start</Trans>;
  if (notice === "no-run") return <Trans>No earlier run on this slide</Trans>;
  if (notice === "no-view") return <Trans>Zoom to a part of the slide first</Trans>;
  return null;
}

export function StartRunPanel(props: StartRunPanelProps) {
  const { t } = useLingui();
  const docked = useDocked();
  const [options, setOptions] = useState<RunOptions>(defaultRunOptions);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>("none");

  const used: RunOptions = props.canTune
    ? {
        ...options,
        scope: options.scope === "selection" && props.selection === null ? "slide" : options.scope,
      }
    : defaultRunOptions;

  const start = async () => {
    const draft: ModelRunDraft | null = buildRunDraft({
      slideId: props.slideId,
      options: used,
      view: used.scope === "view" ? props.currentView() : null,
      selection: props.selection,
      taskId: props.taskId ?? null,
    });
    if (draft === null) {
      setNotice("no-view");
      return;
    }
    setBusy(true);
    setNotice("none");
    try {
      const response = await startModelRuns(props.projectId, draft);
      if (response.status === 201) props.onStarted(response.data.map((run) => run.id));
      else setNotice("failed");
    } catch {
      setNotice("failed");
    } finally {
      setBusy(false);
    }
  };

  const loadLast = async () => {
    setNotice((await props.onLoadLast()) ? "none" : "no-run");
  };

  return (
    <section
      aria-label={t`Find nuclei`}
      data-testid="start-run"
      className={
        docked
          ? "flex flex-col gap-2 rounded-ctl border border-line bg-surf-panel px-3 py-2 text-caption"
          : "pointer-events-auto absolute bottom-14 left-3 z-10 flex flex-col gap-2 rounded-md border border-line bg-chrome px-3 py-2 text-caption shadow-sm"
      }
    >
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          data-testid="start-run-find"
          disabled={busy}
          onClick={() => void start()}
        >
          <Trans>Find nuclei</Trans>
        </Button>
        <Button size="sm" data-testid="start-run-load" onClick={() => void loadLast()}>
          <Trans>Load last run</Trans>
        </Button>
        {props.canTune ? (
          <Button
            size="sm"
            variant="ghost"
            data-testid="start-run-options"
            aria-expanded={open}
            onClick={() => setOpen((before) => !before)}
          >
            <Trans>Options</Trans>
          </Button>
        ) : null}
      </div>
      {props.canTune && open ? (
        <div className="flex flex-col gap-2" data-testid="start-run-options-body">
          <label className="flex items-center justify-between gap-2">
            <Trans>Scope</Trans>
            <select
              data-testid="start-run-scope"
              value={used.scope}
              onChange={(event) =>
                setOptions({ ...options, scope: event.target.value as RunScopeChoice })
              }
            >
              <option value="slide">
                <Trans>Whole slide</Trans>
              </option>
              <option value="view">
                <Trans>What I see now</Trans>
              </option>
              {props.taskId ? (
                <option value="selection" disabled={props.selection === null}>
                  <Trans>The selected shapes</Trans>
                </option>
              ) : null}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            <Trans>Order</Trans>
            <select
              data-testid="start-run-ordering"
              value={options.ordering}
              onChange={(event) =>
                setOptions({
                  ...options,
                  ordering: event.target.value === "tumor-first" ? "tumor-first" : "raster",
                })
              }
            >
              <option value="raster">
                <Trans>Left to right</Trans>
              </option>
              <option value="tumor-first">
                <Trans>Tumor first</Trans>
              </option>
            </select>
          </label>
        </div>
      ) : null}
      <span role="status" data-testid="start-run-notice">
        <Notices notice={notice} />
      </span>
    </section>
  );
}
