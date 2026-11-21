import { Trans, useLingui } from "@lingui/react/macro";
import { Input } from "@parfocal/ui/components/input";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useEffect, useState } from "react";
import {
  deepestLevel,
  defaultTile,
  largestTile,
  type PatchFormat,
  pollPatches,
  refusalText,
  smallestTile,
  startPatches,
} from "../annotations/task-export.ts";

type Phase =
  | { readonly state: "asking" }
  | { readonly state: "starting" }
  | { readonly state: "cutting"; readonly jobId: string }
  | { readonly state: "saved"; readonly jobId: string; readonly name: string }
  | { readonly state: "stopped"; readonly message: string };

const pollEveryMs = 1500;

export function PatchExportDialog({
  taskId,
  datasetVersion = null,
  onClose,
}: {
  taskId: string;
  datasetVersion?: number | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [level, setLevel] = useState("0");
  const [tile, setTile] = useState(String(defaultTile));
  const [format, setFormat] = useState<PatchFormat>("masks");
  const [phase, setPhase] = useState<Phase>({ state: "asking" });
  const levelNumber = Number(level);
  const tileNumber = Number(tile);
  const levelOk = Number.isInteger(levelNumber) && levelNumber >= 0 && levelNumber <= deepestLevel;
  const tileOk =
    Number.isInteger(tileNumber) && tileNumber >= smallestTile && tileNumber <= largestTile;
  const cuttingJob = phase.state === "cutting" ? phase.jobId : null;

  useEffect(() => {
    if (cuttingJob === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      timer = setTimeout(() => {
        void pollPatches(taskId, cuttingJob).then((poll) => {
          if (!live) return;
          if (poll.state === "cutting") next();
          else if (poll.state === "saved")
            setPhase({ state: "saved", jobId: cuttingJob, name: poll.name });
          else setPhase({ state: "stopped", message: t`The patches could not be cut` });
        });
      }, pollEveryMs);
    };
    next();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [cuttingJob, taskId, t]);

  const start = async () => {
    setPhase({ state: "starting" });
    const started = await startPatches(taskId, levelNumber, tileNumber, datasetVersion, format);
    if (started.state === "started") setPhase({ state: "cutting", jobId: started.jobId });
    else setPhase({ state: "stopped", message: refusalText(started.code) });
  };

  const asking = phase.state === "asking" || phase.state === "stopped";
  const jobId = phase.state === "cutting" || phase.state === "saved" ? phase.jobId : null;

  return (
    <SmallModal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={
        datasetVersion === null ? t`Patches with masks` : t`Patches of version ${datasetVersion}`
      }
      subtitle={
        datasetVersion === null
          ? t`Cuts image tiles and class masks from the signed off slides. It runs as a job and downloads when it is done.`
          : t`Cuts image tiles and class masks from the stored GeoJSON of this frozen version. It runs as a job and downloads when it is done.`
      }
      hint={
        phase.state === "stopped" ? (
          <span role="alert" data-testid="patch-export-refusal" className="text-bad">
            {phase.message}
          </span>
        ) : undefined
      }
      primaryLabel={phase.state === "saved" ? t`Done` : t`Cut the patches`}
      primaryBusy={phase.state === "starting" || phase.state === "cutting"}
      primaryDisabled={asking && !(levelOk && tileOk)}
      onPrimary={() => (phase.state === "saved" ? onClose() : void start())}
    >
      <div className="grid gap-3 text-body-sm text-fg">
        <label className="grid gap-1" htmlFor="patch-export-level">
          <span>
            <Trans>Level</Trans>
          </span>
          <Input
            id="patch-export-level"
            data-testid="patch-export-level"
            type="number"
            min={0}
            max={deepestLevel}
            value={level}
            disabled={!asking}
            aria-invalid={!levelOk}
            onChange={(event) => setLevel(event.target.value)}
          />
          <small className="text-caption text-fg-dim">
            <Trans>0 is the sharpest level. Each level up halves the size.</Trans>
          </small>
        </label>
        <label className="grid gap-1" htmlFor="patch-export-tile">
          <span>
            <Trans>Tile size in pixels</Trans>
          </span>
          <Input
            id="patch-export-tile"
            data-testid="patch-export-tile"
            type="number"
            min={smallestTile}
            max={largestTile}
            value={tile}
            disabled={!asking}
            aria-invalid={!tileOk}
            onChange={(event) => setTile(event.target.value)}
          />
          <small className="text-caption text-fg-dim">
            <Trans>
              From {smallestTile} to {largestTile}.
            </Trans>
          </small>
        </label>
        <div className="grid gap-1">
          <span id="patch-export-format-label">
            <Trans>Annotations</Trans>
          </span>
          <SegmentedControl
            aria-labelledby="patch-export-format-label"
            data-testid="patch-export-format"
            value={format}
            disabled={!asking}
            onValueChange={(next) => setFormat(next as PatchFormat)}
            options={[
              { value: "masks", label: t`Class masks` },
              { value: "coco", label: t`Masks and COCO` },
            ]}
          />
          <small className="text-caption text-fg-dim">
            {format === "coco" ? (
              <Trans>
                Also writes annotations.json in COCO form, one polygon per object clipped to its
                tile.
              </Trans>
            ) : (
              <Trans>One class mask per tile.</Trans>
            )}
          </small>
        </div>
        {jobId === null ? null : (
          <p className="m-0 grid gap-0.5" data-testid="patch-export-job" aria-live="polite">
            <span>
              {phase.state === "saved" ? t`The patches are ready` : t`Cutting the patches`}
            </span>
            <small className="text-caption text-fg-dim">
              <Trans>Job {jobId.slice(0, 8)}</Trans>
            </small>
            {phase.state === "saved" ? (
              <small className="text-caption text-fg-dim">
                <Trans>Saved {phase.name}</Trans>
              </small>
            ) : null}
          </p>
        )}
      </div>
    </SmallModal>
  );
}
