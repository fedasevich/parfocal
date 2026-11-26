import { Trans, useLingui } from "@lingui/react/macro";
import {
  getGetUploadStatusQueryOptions,
  getListSlideResultSetsQueryKey,
  IngestStatus,
  type UploadState,
  useLeaveResultOut,
  useListProjectSlides,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@parfocal/ui/components/popover";
import { Progress } from "@parfocal/ui/components/progress";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { FileDropZone, FileList, FileRow, TextLink } from "../screens/upload/parts.tsx";
import { resultFormatRows } from "../screens/upload/result-format-rows.ts";
import { resultAccept, resultFileKindOf } from "../screens/upload/result-formats.ts";
import { ResultProblems } from "../screens/upload/result-problems.tsx";
import type { ResultUpload } from "../screens/upload/result-problems-model.ts";
import { type DroppedItem, kindOf } from "../upload/drop.ts";
import { formatBytes, sameFile } from "../upload/entries.ts";
import { useUploads } from "../upload/use-uploads.ts";
import { useDocked } from "../viewer/inspector-slots.tsx";
import {
  type FilePreview,
  previewShapeCap,
  readFilePreview,
  type StagePreview,
} from "./file-preview.ts";
import { isUnplaced, noPlacement, type Placement, placedText } from "./geojson-placement.ts";

export type DroppedFiles = { readonly items: readonly DroppedItem[]; readonly at: number };

type AddResultSetProps = {
  projectId: string;
  slideId: string;
  dropped: DroppedFiles | null;
  onClose: () => void;
  onAdded: (name: string) => void;
  onPreview: (preview: StagePreview | null) => void;
};

type Picked = { file: File; preview: FilePreview };

type Refusal = "several" | "slide" | "unsupported";

type Sent = { file: File; uploadId: string | null };

const numberOf = (text: string, fallback: number) => {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) ? value : fallback;
};

const finished = (status: string) =>
  status === IngestStatus.ready || status === IngestStatus.failed;

const percentOf = (done: number, size: number) =>
  size === 0 ? 0 : Math.min(100, Math.floor((done / size) * 100));

function useUploadState(uploadId: string | null): UploadState | null {
  const found = useQuery({
    ...getGetUploadStatusQueryOptions(uploadId ?? "", {
      query: {
        refetchInterval: (query) => {
          const reply = query.state.data;
          return reply?.status === 200 && finished(reply.data.status) ? false : 800;
        },
      },
    }),
    enabled: uploadId !== null,
  });
  return found.data?.status === 200 ? found.data.data : null;
}

function FormatsHelp() {
  const { t } = useLingui();
  return (
    <Popover>
      <PopoverTrigger
        render={<Button size="sm" variant="ghost" data-testid="add-result-formats" />}
      >
        <Icon name="help" />
        <Trans>What files work?</Trans>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={t`What files work?`} className="w-80 gap-2 p-3">
        <FileList>
          {resultFormatRows.map(([name, text]) => (
            <div key={name} className="grid gap-0.5 border-line px-3 py-2 [&+&]:border-t">
              <b className="text-body-sm font-semibold">{name}</b>
              <small className="text-caption leading-[1.4] text-fg-dim">{text}</small>
            </div>
          ))}
        </FileList>
        <p className="m-0 text-caption text-fg-dim">
          <Trans>
            One file at a time: .geojson, .json, .csv, .tsv, .png, .tif or .tiff. Parfocal checks it
            after Save.
          </Trans>
        </p>
      </PopoverContent>
    </Popover>
  );
}

function PreviewNote({ preview }: { preview: FilePreview }) {
  if (preview.kind === "image")
    return <Trans>Drawn over the slide at half strength in the preview, not saved yet.</Trans>;
  if (preview.kind === "none") {
    if (preview.why === "raster")
      return <Trans>A TIFF has no preview here. It is checked after Save.</Trans>;
    if (preview.why === "large")
      return <Trans>Too large to preview, it is checked after Save.</Trans>;
    return <Trans>Parfocal cannot draw this file here. It is checked after Save.</Trans>;
  }
  const total = preview.total;
  const cap = previewShapeCap.toLocaleString("en");
  return total > previewShapeCap ? (
    <Trans>
      Showing {cap} of {total.toLocaleString("en")} shapes in cyan, not saved yet.
    </Trans>
  ) : (
    <Trans>{preview.results.objects} objects, shown in cyan and not saved yet.</Trans>
  );
}

export function AddResultSet({
  projectId,
  slideId,
  dropped,
  onClose,
  onAdded,
  onPreview,
}: AddResultSetProps) {
  const { t } = useLingui();
  const docked = useDocked();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { engine, entries } = useUploads();
  const leave = useLeaveResultOut();
  const slide = okData(useListProjectSlides(projectId).data)?.find((item) => item.id === slideId);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [placement, setPlacement] = useState<Placement>(noPlacement);
  const [sent, setSent] = useState<Sent | null>(null);
  const state = useUploadState(sent?.uploadId ?? null);
  const entry =
    sent === null
      ? undefined
      : entries.find((candidate) =>
          sameFile(candidate, {
            projectId,
            caseId: null,
            name: sent.file.name,
            size: sent.file.size,
            lastModified: sent.file.lastModified,
          }),
        );

  const take = async (items: readonly DroppedItem[]) => {
    const first = items[0];
    if (first === undefined) return;
    const refused: Refusal | null =
      items.length > 1
        ? "several"
        : resultFileKindOf(first.file.name) !== null
          ? null
          : kindOf(first.path) === "slide"
            ? "slide"
            : "unsupported";
    setRefusal(refused);
    if (refused !== null) {
      setPicked(null);
      return;
    }
    const preview = await readFilePreview(first.file);
    setPlacement(noPlacement);
    setPicked({ file: first.file, preview });
  };

  const takeDropped = useRef((items: readonly DroppedItem[]) => void items);
  takeDropped.current = (items) => {
    if (sent === null) void take(items);
  };
  useEffect(() => {
    if (dropped !== null) takeDropped.current(dropped.items);
  }, [dropped]);

  useEffect(() => {
    const shown = picked?.preview;
    if (shown === undefined || sent !== null) onPreview(null);
    else if (shown.kind === "shapes")
      onPreview({ kind: "shapes", results: shown.results, placement });
    else if (shown.kind === "image") onPreview({ kind: "image", url: shown.url });
    else onPreview(null);
  }, [picked, placement, sent, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);
  useEffect(() => {
    const shown = picked?.preview;
    return () => {
      if (shown?.kind === "image") URL.revokeObjectURL(shown.url);
    };
  }, [picked]);

  const ready = state?.status === IngestStatus.ready;
  const name = sent?.file.name ?? "";
  useEffect(() => {
    if (!ready) return;
    void queryClient.invalidateQueries({ queryKey: getListSlideResultSetsQueryKey(slideId) });
    onAdded(name);
  }, [ready, queryClient, slideId, name, onAdded]);

  const save = async () => {
    if (picked === null) return;
    const shown = picked.preview;
    const aligned = shown.kind === "shapes" && shown.text !== null && !isUnplaced(placement);
    const file =
      aligned && shown.text !== null
        ? new File([placedText(shown.text, placement)], picked.file.name, {
            type: "application/geo+json",
            lastModified: picked.file.lastModified,
          })
        : picked.file;
    setSent({ file, uploadId: null });
    await engine.addFiles([file], { projectId, caseId: null, slideId }, (uploadId) =>
      setSent({ file, uploadId }),
    );
  };

  const cancel = () => {
    if (entry !== undefined && entry.status !== "done") void engine.cancel(entry.id);
    else if (sent?.uploadId != null && state?.status === IngestStatus.waiting)
      leave.mutate({ uploadId: sent.uploadId });
    onClose();
  };

  const again = () => {
    setSent(null);
    setPicked(null);
    setRefusal(null);
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

  const toUpload = () =>
    void navigate({ to: "/projects/$projectId/upload", params: { projectId } });

  const failed =
    state?.status === IngestStatus.failed && state.reason !== "result-heatmap-not-stored";
  const upload: ResultUpload | null =
    sent?.uploadId == null || state === null
      ? null
      : {
          uploadId: sent.uploadId,
          name,
          status: state.status,
          reason: state.reason,
          message: state.message,
        };
  const needsYou =
    upload !== null &&
    (upload.reason === "needs-choices" || upload.reason === "result-heatmap-not-stored");
  const uploading = entry !== undefined && entry.status !== "done";

  return (
    <section
      aria-label={t`Add a result set`}
      data-testid="add-result-set-panel"
      data-phase={sent === null ? (picked === null ? "choose" : "preview") : "saving"}
      className={
        docked
          ? "grid gap-3 rounded-zone border border-surf-edge bg-surf-section p-3"
          : "absolute top-4 left-20 z-10 grid max-h-[calc(100%-2rem)] w-96 gap-3 overflow-auto rounded-ctl border border-line bg-chrome p-3 shadow-pop"
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <h2 className="m-0 text-body font-semibold">
            <Trans>Add a result set</Trans>
          </h2>
          <span className="truncate text-caption text-fg-dim" data-testid="add-result-target">
            {slide === undefined ? (
              <Trans>To this slide</Trans>
            ) : (
              <Trans>To slide {slide.label}</Trans>
            )}
          </span>
        </div>
        <FormatsHelp />
      </div>
      {sent !== null ? (
        <div className="grid gap-2" data-testid="add-result-sending">
          <FileList>
            <FileRow
              lead={
                <span className="grid w-10 place-items-center text-fg-faint">
                  <Icon name="file" />
                </span>
              }
              name={sent.file.name}
              detail={formatBytes(sent.file.size)}
            />
          </FileList>
          {failed ? (
            <div className="grid gap-2" data-testid="add-result-failed">
              <p role="alert" className="m-0 text-body-sm text-danger">
                {state.message ?? <Trans>The file could not be added.</Trans>}
              </p>
              <Button size="sm" onClick={again}>
                <Trans>Choose another file</Trans>
              </Button>
            </div>
          ) : needsYou ? (
            <div data-testid="add-result-choices" className="grid gap-2">
              <ResultProblems uploads={[upload]} projectId={projectId} />
            </div>
          ) : uploading ? (
            <Progress
              data-testid="add-result-uploading"
              value={percentOf(entry.bytesUploaded, entry.size)}
              aria-label={t`Upload of ${name}`}
            />
          ) : (
            <p className="m-0 text-body-sm text-fg-dim" data-testid="add-result-progress">
              <Trans>Checking the file and adding it to the slide</Trans>
            </p>
          )}
        </div>
      ) : picked === null ? (
        <div className="grid gap-2">
          <FileDropZone
            compact
            testId="add-result-drop"
            inputTestId="add-result-file"
            title={<Trans>Drop a result file</Trans>}
            label={t`Drop a result file`}
            pick={<Trans>Choose a file</Trans>}
            detail={
              <Trans>
                {" "}
                or drop it on the slide. GeoJSON, Parfocal JSON, CSV, masks and heatmaps. You see it
                on the slide before anything is saved.
              </Trans>
            }
            inputLabel={t`Result file`}
            accept={resultAccept}
            onFiles={(items) => void take(items)}
          />
          {refusal === null ? null : (
            <p
              role="alert"
              className="m-0 text-body-sm text-danger"
              data-testid="add-result-refused"
            >
              {refusal === "several" ? (
                <Trans>Add one result file at a time here.</Trans>
              ) : refusal === "slide" ? (
                <Trans>That is a slide, not a result file.</Trans>
              ) : (
                <Trans>Parfocal cannot read that kind of file as results.</Trans>
              )}{" "}
              <TextLink onClick={toUpload}>
                <Trans>Use the full upload</Trans>
              </TextLink>
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          <FileList>
            <FileRow
              lead={
                <span className="grid w-10 place-items-center text-fg-faint">
                  <Icon name="file" />
                </span>
              }
              name={picked.file.name}
              detail={formatBytes(picked.file.size)}
              end={
                <TextLink onClick={again} className="px-2">
                  <Trans>Change</Trans>
                </TextLink>
              }
            />
          </FileList>
          <p className="m-0 text-body-sm text-fg-dim" data-testid="add-result-summary">
            <PreviewNote preview={picked.preview} />
          </p>
          {picked.preview.kind === "shapes" && picked.preview.alignable ? (
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
          ) : null}
        </div>
      )}
      <div className="flex items-center gap-2">
        {sent === null ? (
          <Button
            variant="primary"
            disabled={picked === null}
            data-testid="add-result-save"
            onClick={() => void save()}
          >
            <Trans>Save</Trans>
          </Button>
        ) : null}
        <Button variant="ghost" onClick={cancel} data-testid="add-result-cancel">
          <Trans>Cancel</Trans>
        </Button>
      </div>
    </section>
  );
}
