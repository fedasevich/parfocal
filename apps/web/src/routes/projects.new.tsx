import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { shellStore } from "../shell/shell-store.ts";

export const Route = createFileRoute("/projects/new")({
  component: NewProjectRoute,
});

function NewProjectRoute() {
  const navigate = useNavigate();
  useEffect(() => {
    shellStore.setState({ newProjectOpen: true });
    void navigate({ to: "/", replace: true });
  }, [navigate]);
  return null;
}
