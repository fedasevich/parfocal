import { createFileRoute } from "@tanstack/react-router";
import { SharedReportScreen } from "../screens/shared-report/shared-report-screen.tsx";

export const Route = createFileRoute("/shared-reports/$token")({
  component: SharedReport,
});

function SharedReport() {
  const { token } = Route.useParams();
  return <SharedReportScreen token={token} />;
}
