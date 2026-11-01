import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";
import { mockScenes } from "../screens/scenes.ts";

const clinicalReportSearch = z.object({
  scene: z.enum(mockScenes.creport).optional(),
});

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/report")({
  validateSearch: clinicalReportSearch,
  component: ClinicalReport,
});

function ClinicalReport() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <Placeholder
      title="Clinical report"
      builtBy="PROTO-014 (clinical report, sign-out and co-sign)"
      route={{ params, search }}
    />
  );
}
