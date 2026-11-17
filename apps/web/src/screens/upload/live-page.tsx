import { useLingui } from "@lingui/react/macro";
import { useGetProject } from "@parfocal/api-client";
import { SkeletonPanel } from "@parfocal/ui/components/skeleton";
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
      <main className="mx-auto w-full max-w-3xl flex-1 p-8">
        <SkeletonPanel label={t`Loading the upload`} sections={4} />
      </main>
    );
  }
  const live: LiveScene =
    scene !== undefined && liveScenes.includes(scene) ? (scene as LiveScene) : "empty";
  return <LiveWizard project={project} scene={live} />;
}
