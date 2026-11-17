import { createFileRoute } from "@tanstack/react-router";
import { CosignScreen } from "../screens/clinical-report/cosign-screen.tsx";
import { coSignSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/projects/$projectId/cases/$caseId/co-sign")({
  validateSearch: coSignSearch,
  component: CoSignReview,
});

function CoSignReview() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return <CosignScreen projectId={params.projectId} caseId={params.caseId} scene={search.scene} />;
}
