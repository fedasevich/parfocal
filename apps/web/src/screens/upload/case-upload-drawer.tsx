import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Project } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { DrawerPanel } from "@parfocal/ui/components/drawer-panel";
import { Icon } from "@parfocal/ui/components/icon";
import { Progress } from "@parfocal/ui/components/progress";
import { Hint } from "@parfocal/ui/components/zone";
import { useRef } from "react";
import { formatBytes, type UploadEntry } from "../../upload/entries.ts";
import { useUploads } from "../../upload/use-uploads.ts";
import { FileDropZone, FileList, FileRow } from "./parts.tsx";

function percent(entry: UploadEntry): number {
  if (entry.size === 0) return 0;
  return Math.min(100, Math.floor((entry.bytesUploaded / entry.size) * 100));
}

function statusText(entry: UploadEntry): string {
  const total = formatBytes(entry.size);
  switch (entry.status) {
    case "uploading":
      return t`${formatBytes(entry.bytesUploaded)} of ${total}`;
    case "paused":
      return t`Paused at ${formatBytes(entry.bytesUploaded)} of ${total}`;
    case "retrying":
      return t`Connection lost. Trying again, attempt ${entry.attempt} of 3`;
    case "failed":
      return t`Stopped at ${formatBytes(entry.bytesUploaded)} of ${total}. What was stored is kept`;
    case "done":
      return `${total}, uploaded`;
    case "interrupted":
      return t`${total}. Choose this file again to continue where it stopped`;
  }
}

function UploadRow({ entry, onChoose }: { entry: UploadEntry; onChoose: () => void }) {
  const { t } = useLingui();

  const { engine } = useUploads();
  const showBar = entry.status !== "interrupted" && entry.status !== "done";
  return (
    <div data-testid="upload-row" data-status={entry.status}>
      <FileRow
        lead={
          <span className="grid w-10 place-items-center text-fg-faint">
            <Icon name={entry.status === "done" ? "check" : "file"} />
          </span>
        }
        name={entry.name}
        detail={statusText(entry)}
        end={
          <span className="flex items-center gap-1.5">
            {entry.status === "uploading" ? (
              <Button size="sm" onClick={() => engine.pause(entry.id)}>
                <Trans>Pause</Trans>
              </Button>
            ) : null}
            {entry.status === "paused" ? (
              <Button size="sm" onClick={() => engine.resume(entry.id)}>
                <Trans>Resume</Trans>
              </Button>
            ) : null}
            {entry.status === "failed" || entry.status === "retrying" ? (
              <Button size="sm" onClick={() => engine.retry(entry.id)}>
                <Trans>Retry</Trans>
              </Button>
            ) : null}
            {entry.status === "interrupted" ? (
              <Button size="sm" onClick={onChoose}>
                <Trans>Choose file</Trans>
              </Button>
            ) : null}
            {entry.status === "done" || entry.status === "interrupted" ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label={t`Remove ${entry.name}`}
                onClick={() => engine.dismiss(entry.id)}
              >
                <Icon name="close" />
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void engine.cancel(entry.id)}>
                <Trans>Cancel</Trans>
              </Button>
            )}
          </span>
        }
      />
      {showBar ? (
        <Progress
          value={percent(entry)}
          aria-label={t`Upload of ${entry.name}`}
          className="px-3 pb-2"
        />
      ) : null}
    </div>
  );
}

export function CaseUploadDrawer({
  project,
  caseId,
  onClose,
}: {
  project: Project;
  caseId: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();

  const { engine, entries } = useUploads();
  const picker = useRef<HTMLInputElement>(null);
  const mine = entries.filter((entry) => entry.projectId === project.id && entry.caseId === caseId);

  const take = (files: File[]) => {
    if (files.length === 0) return;
    void engine.addFiles(files, { projectId: project.id, caseId });
  };

  return (
    <DrawerPanel
      label={t`Upload slides`}
      title={t`Upload slides`}
      hint={t`to ${project.code} · ${project.name}`}
      width={560}
      testId="upload-drawer"
      onClose={onClose}
    >
      <FileDropZone
        title={<Trans>Drop slides here</Trans>}
        label={t`Drop slides here`}
        pickerRef={picker}
        lead={
          <>
            <Trans>or</Trans>{" "}
          </>
        }
        pick={<Trans>choose files</Trans>}
        detail={
          <Trans>
            . Large files upload in parts, so a lost connection or a closed tab does not start them
            over.
          </Trans>
        }
        inputLabel={t`Choose slide files`}
        multiple
        onFiles={(items) => take(items.map((item) => item.file))}
      />
      {mine.length > 0 ? (
        <FileList>
          {mine.map((entry) => (
            <UploadRow key={entry.id} entry={entry} onChoose={() => picker.current?.click()} />
          ))}
        </FileList>
      ) : (
        <Hint>
          <Trans>No files yet.</Trans>
        </Hint>
      )}
    </DrawerPanel>
  );
}
