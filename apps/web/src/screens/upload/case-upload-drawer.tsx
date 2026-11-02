import type { Project } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { DrawerPanel } from "@parfocal/ui/components/drawer-panel";
import { Icon } from "@parfocal/ui/components/icon";
import { Progress } from "@parfocal/ui/components/progress";
import { Hint } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import { type DragEvent, useRef, useState } from "react";
import { formatBytes, type UploadEntry } from "../../upload/entries.ts";
import { useUploads } from "../../upload/use-uploads.ts";
import { FileList, FileRow, TextLink } from "./parts.tsx";

function percent(entry: UploadEntry): number {
  if (entry.size === 0) return 0;
  return Math.min(100, Math.floor((entry.bytesUploaded / entry.size) * 100));
}

function statusText(entry: UploadEntry): string {
  const total = formatBytes(entry.size);
  switch (entry.status) {
    case "uploading":
      return `${formatBytes(entry.bytesUploaded)} of ${total}`;
    case "paused":
      return `Paused at ${formatBytes(entry.bytesUploaded)} of ${total}`;
    case "retrying":
      return `Connection lost. Trying again, attempt ${entry.attempt} of 3`;
    case "failed":
      return `Stopped at ${formatBytes(entry.bytesUploaded)} of ${total}. What was stored is kept`;
    case "done":
      return `${total}, uploaded`;
    case "interrupted":
      return `${total}. Choose this file again to continue where it stopped`;
  }
}

function UploadRow({ entry, onChoose }: { entry: UploadEntry; onChoose: () => void }) {
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
                Pause
              </Button>
            ) : null}
            {entry.status === "paused" ? (
              <Button size="sm" onClick={() => engine.resume(entry.id)}>
                Resume
              </Button>
            ) : null}
            {entry.status === "failed" || entry.status === "retrying" ? (
              <Button size="sm" onClick={() => engine.retry(entry.id)}>
                Retry
              </Button>
            ) : null}
            {entry.status === "interrupted" ? (
              <Button size="sm" onClick={onChoose}>
                Choose file
              </Button>
            ) : null}
            {entry.status === "done" || entry.status === "interrupted" ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove ${entry.name}`}
                onClick={() => engine.dismiss(entry.id)}
              >
                <Icon name="close" />
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void engine.cancel(entry.id)}>
                Cancel
              </Button>
            )}
          </span>
        }
      />
      {showBar ? (
        <Progress
          value={percent(entry)}
          aria-label={`Upload of ${entry.name}`}
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
  const { engine, entries } = useUploads();
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const mine = entries.filter((entry) => entry.projectId === project.id && entry.caseId === caseId);

  const take = (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    void engine.addFiles([...files], { projectId: project.id, caseId });
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    take(event.dataTransfer.files);
  };

  return (
    <DrawerPanel
      label="Upload slides"
      title="Upload slides"
      hint={`to ${project.code} · ${project.name}`}
      width={560}
      testId="upload-drawer"
      onClose={onClose}
    >
      <section
        data-testid="drop-zone"
        aria-label="Drop slides here"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "grid justify-items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center",
          dragging ? "border-accent bg-chrome-2" : "border-line-strong",
        )}
      >
        <Icon name="upload" size="lg" className="text-accent" />
        <b className="text-body text-fg">Drop slides here</b>
        <span className="text-body-sm text-fg-dim">
          or <TextLink onClick={() => picker.current?.click()}>choose files</TextLink>. Large files
          upload in parts, so a lost connection or a closed tab does not start them over.
        </span>
        <input
          ref={picker}
          type="file"
          multiple
          data-testid="file-input"
          aria-label="Choose slide files"
          className="sr-only"
          onChange={(event) => {
            take(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </section>
      {mine.length > 0 ? (
        <FileList>
          {mine.map((entry) => (
            <UploadRow key={entry.id} entry={entry} onChoose={() => picker.current?.click()} />
          ))}
        </FileList>
      ) : (
        <Hint>No files yet.</Hint>
      )}
    </DrawerPanel>
  );
}
