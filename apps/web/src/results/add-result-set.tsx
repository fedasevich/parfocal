import { Trans, useLingui } from "@lingui/react/macro";
import {
  getGetUploadStatusQueryOptions,
  getListSlideResultSetsQueryKey,
  IngestStatus,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Input } from "@parfocal/ui/components/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ResultProblems } from "../screens/upload/result-problems.tsx";
import type { ResultUpload } from "../screens/upload/result-problems-model.ts";
import { useUploadEngine } from "../upload/use-uploads.ts";
import { useDocked } from "../viewer/inspector-slots.tsx";
import {
  isUnplaced,
  noPlacement,
  type ParsedResults,
  type Placement,
  parseResults,
  placedText,
} from "./geojson-placement.ts";

type AddResultSetProps = {
  projectId: string;
  slideId: string;
  onClose: () => void;
  onPreview: (preview: { results: ParsedResults; placement: Placement } | null) => void;
};

type Picked = { file: File; text: string; results: ParsedResults };

const numberOf = (text: string, fallback: number) => {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) ? value : fallback;
};

const finished = (status: string) =>
  status === IngestStatus.ready || status === IngestStatus.failed;

function Sending({
  uploadId,
  name,
  projectId,
  slideId,
  onDone,
  onRetry,
}: {
  uploadId: string;
  name: string;
  projectId: string;
  slideId: string;
  onDone: () => void;
  onRetry: () => void;
}) {
  const queryClient = useQueryClient();
  const found = useQuery(
    getGetUploadStatusQueryOptions(uploadId, {
      query: {
        refetchInterval: (query) => {
          const reply = query.state.data;
          return reply?.status === 200 && finished(reply.data.status) ? false : 800;
        },
      },
    }),
  );
  const state = found.data?.status === 200 ? found.data.data : null;
  const ready = state?.status === IngestStatus.ready;
  useEffect(() => {
    if (!ready) return;
    void queryClient.invalidateQueries({ queryKey: getListSlideResultSetsQueryKey(slideId) });
    onDone();
  }, [ready, queryClient, slideId, onDone]);
  if (state?.status === IngestStatus.failed && state.reason !== "result-heatmap-not-stored") {
    return (
      <div className="grid gap-2" data-testid="add-result-failed">
        <p className="m-0 text-body-sm">
          {state.message ?? <Trans>The file could not be added.</Trans>}
        </p>
        <Button size="sm" onClick={onRetry}>
          <Trans>Choose another file</Trans>
        </Button>
      </div>
    );
  }
  const upload: ResultUpload | null =
    state === null
      ? null
      : {
          uploadId,
          name,
          status: state.status,
          reason: state.reason,
          message: state.message,
        };
  const needsYou =
    upload !== null &&
    (upload.reason === "needs-choices" || upload.reason === "result-heatmap-not-stored");
  return needsYou ? (
    <div data-testid="add-result-choices" className="grid gap-2">
      <ResultProblems uploads={[upload]} projectId={projectId} />
    </div>
  ) : (
    <p className="m-0 text-body-sm text-fg-dim" data-testid="add-result-progress">
      <Trans>Adding the result set to the slide</Trans>
    </p>
  );
}

export function AddResultSet({ projectId, slideId, onClose, onPreview }: AddResultSetProps) {
  const { t } = useLingui();
  const docked = useDocked();
  const engine = useUploadEngine();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [placement, setPlacement] = useState<Placement>(noPlacement);
  const [sent, setSent] = useState<{ uploadId: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    onPreview(picked === null || sent !== null ? null : { results: picked.results, placement });
  }, [picked, placement, sent, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const choose = async (file: File | undefined) => {
    if (file === undefined) return;
    const text = await file.text();
    const results = parseResults(text);
    if (results === null) {
      setProblem(t`That file has no shapes Parfocal can draw. Choose a GeoJSON file.`);
      setPicked(null);
      return;
    }
    setProblem(null);
    setPlacement(noPlacement);
    setPicked({ file, text, results });
  };

  const send = async () => {
    if (picked === null) return;
    setSending(true);
    const body = isUnplaced(placement) ? picked.text : placedText(picked.text, placement);
    const file = new File([body], picked.file.name, {
      type: "application/geo+json",
      lastModified: picked.file.lastModified,
    });
    await engine.addFiles([file], { projectId, caseId: null, slideId }, (uploadId) =>
      setSent({ uploadId, name: picked.file.name }),
    );
    setSending(false);
  };

  const field = (label: string, value: number, step: number, change: (next: number) => void) => (
    <div className="grid gap-1 text-caption text-fg-dim">
      <span aria-hidden="true">{label}</span>
      <Input
        type="number"
        step={step}
        aria-label={label}
        value={value}
        onChange={(event) => change(numberOf(event.target.value, value))}
      />
    </div>
  );

  return (
    <section
      aria-label={t`Add a result set`}
      data-testid="add-result-set-panel"
      className={
        docked
          ? "grid gap-3 rounded-ctl border border-line bg-surf-panel p-3"
          : "absolute top-4 left-20 z-10 grid max-h-[calc(100%-2rem)] w-96 gap-3 overflow-auto rounded-ctl border border-line bg-chrome p-3 shadow-pop"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-body font-semibold">
          <Trans>Add a result set</Trans>
        </h2>
        <Button size="sm" variant="ghost" onClick={onClose} data-testid="add-result-cancel">
          <Trans>Cancel</Trans>
        </Button>
      </div>
      {sent !== null ? (
        <Sending
          uploadId={sent.uploadId}
          name={sent.name}
          projectId={projectId}
          slideId={slideId}
          onDone={onClose}
          onRetry={() => {
            setSent(null);
            setPicked(null);
          }}
        />
      ) : picked === null ? (
        <div className="grid gap-2">
          <p className="m-0 text-body-sm text-fg-dim">
            <Trans>
              Choose a GeoJSON file. You see it on the slide in cyan before anything is saved.
            </Trans>
          </p>
          <input
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            aria-label={t`Result file`}
            data-testid="add-result-file"
            onChange={(event) => void choose(event.target.files?.[0])}
          />
          {problem === null ? null : (
            <p role="alert" className="m-0 text-body-sm text-danger">
              {problem}
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="m-0 text-body-sm" data-testid="add-result-summary">
            <b className="font-mono">{picked.file.name}</b>
            {", "}
            <Trans>{picked.results.objects} objects, shown in cyan and not saved yet</Trans>
          </p>
          <div className="grid gap-2" data-testid="add-result-fixes">
            <span className="text-caption font-semibold text-fg-dim uppercase">
              <Trans>Alignment</Trans>
            </span>
            <div className="grid grid-cols-3 gap-2">
              {field(t`Shift x`, placement.dx, 10, (dx) => setPlacement({ ...placement, dx }))}
              {field(t`Shift y`, placement.dy, 10, (dy) => setPlacement({ ...placement, dy }))}
              {field(t`Scale`, placement.scale, 0.05, (scale) =>
                setPlacement({ ...placement, scale: scale > 0 ? scale : placement.scale }),
              )}
            </div>
            <Button
              size="sm"
              disabled={isUnplaced(placement)}
              onClick={() => setPlacement(noPlacement)}
            >
              <Trans>Reset alignment</Trans>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              disabled={sending}
              data-testid="add-result-save"
              onClick={() => void send()}
            >
              <Trans>Add result set</Trans>
            </Button>
            <Button onClick={() => setPicked(null)}>
              <Trans>Choose another file</Trans>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
