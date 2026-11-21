import { Trans, useLingui } from "@lingui/react/macro";
import { Input } from "@parfocal/ui/components/input";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useEffect, useState } from "react";
import {
  deepestLevel,
  defaultTile,
  largestTile,
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
    const timer = setInterval(() => {
      void pollPatches(taskId, cuttingJob).then((poll) => {
        if (!live || poll.state === "cutting") return;
        if (poll.state === "saved")
          setPhase({ state: "saved", jobId: cuttingJob, name: poll.name });
        else setPhase({ state: "stopped", message: t`The patches could not be cut` });
      });
    }, pollEveryMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [cuttingJob, taskId, t]);

  const start = async () => {
    setPhase({ state: "starting" });
    const started = await startPatches(taskId, levelNumber, tileNumber, datasetVersion);
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
