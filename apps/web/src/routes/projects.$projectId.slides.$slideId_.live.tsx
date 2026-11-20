import { createFileRoute } from "@tanstack/react-router";
import { liveSearch } from "../search/route-searches.ts";
import { slideRedirect } from "../viewer/old-slide-address.ts";
import { modeOfWorkspace } from "../viewer/viewer-mode.ts";

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/live")({
  validateSearch: liveSearch,
  beforeLoad: ({ params, search, location }) => {
    const streaming = (location.search as Record<string, unknown>)["scene"] === "streaming";
    throw slideRedirect(params, location.search, {
      workspace: undefined,
      ...(streaming ? { scene: undefined, run: "streaming" } : {}),
      mode:
        search.workspace === undefined
          ? undefined
          : modeOfWorkspace(search.workspace, search.task !== undefined),
    });
  },
});
