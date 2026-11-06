import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ReportScreen } from "../screens/clinical-report/report-screen.tsx";
import { mockScenes } from "../screens/scenes.ts";

const clinicalReportSearch = z.object({
  scene: z.enum(mockScenes.creport).optional(),
  step: z.enum(["findings", "staging", "text", "sign"]).optional(),
  modal: z.enum(["deposit", "sign", "amend"]).optional(),
});

export const Route = createFileRoute("/projects/$projectId/cases/$caseId/report")({
  validateSearch: clinicalReportSearch,
  component: ClinicalReport,
});

function ClinicalReport() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ReportScreen
      projectId={params.projectId}
      caseId={params.caseId}
      scene={search.scene}
      step={search.step}
      modal={search.modal}
      keep={search.scene === undefined}
      onNavigate={(to) =>
        void navigate({
          search: (previous) => ({ ...previous, step: to.step, modal: to.modal }),
          replace: to.step === search.step,
        })
      }
    />
  );
}
