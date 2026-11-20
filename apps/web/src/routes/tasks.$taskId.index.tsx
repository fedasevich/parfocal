import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/tasks/$taskId/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/tasks/$taskId/guided", params, replace: true });
  },
});
