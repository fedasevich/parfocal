import { useGetProject } from "@parfocal/api-client";
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
  const project = okData(useGetProject(projectId).data);
  useEffect(() => {
    dropStore.begin(projectId);
  }, [projectId]);
  if (project === undefined) {
    return (
      <main className="grid flex-1 place-items-center p-8 text-body-sm text-fg-dim">
        Loading the upload…
      </main>
    );
  }
  const live: LiveScene =
    scene !== undefined && liveScenes.includes(scene) ? (scene as LiveScene) : "empty";
  return <LiveWizard project={project} scene={live} />;
}
