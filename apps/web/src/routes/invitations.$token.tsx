import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/invitations/$token")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/invite", search: { token: params.token } });
  },
});
