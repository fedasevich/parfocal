import { useLingui } from "@lingui/react/macro";
import { useGetProject } from "@parfocal/api-client";
import { FlowPageSkeleton } from "@parfocal/ui/components/flow-page";
import { SkeletonZone } from "@parfocal/ui/components/skeleton-layouts";
import { useEffect } from "react";
import { dropStore } from "../../upload/drop-store.ts";
import { okData } from "../placeholder.tsx";
import { type LiveScene, LiveWizard } from "./live-wizard.tsx";
import type { UploadScene } from "./state.ts";

const liveScenes: UploadScene[] = ["empty", "files", "check", "progress", "done"];

export function LivePage({
  projectId,
  scene,
}: {
  projectId: string;
  scene: UploadScene | undefined;
}) {
  const { t } = useLingui();

  const project = okData(useGetProject(projectId).data);
  useEffect(() => {
    dropStore.begin(projectId);
  }, [projectId]);
  if (project === undefined) {
    return (
      <main className="flex min-h-0 flex-1 flex-col">
        <FlowPageSkeleton className="h-full" label={t`Loading the upload`} steps={3}>
          <SkeletonZone fields={2} />
          <SkeletonZone fields={3} />
        </FlowPageSkeleton>
      </main>
    );
  }
  const live: LiveScene =
    scene !== undefined && liveScenes.includes(scene) ? (scene as LiveScene) : "empty";
  return <LiveWizard project={project} scene={live} />;
}
