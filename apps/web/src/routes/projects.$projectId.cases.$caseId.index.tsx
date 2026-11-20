import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/projects/$projectId/cases/$caseId/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/projects/$projectId/cases/$caseId/report",
      params,
      replace: true,
    });
  },
});
