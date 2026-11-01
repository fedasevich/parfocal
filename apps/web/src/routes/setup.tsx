import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";

const setupSearch = z.object({ step: z.number().int().min(1).max(5).default(1) });

export const Route = createFileRoute("/setup")({
  validateSearch: setupSearch,
  component: Setup,
});

function Setup() {
  const search = Route.useSearch();
  return (
    <Placeholder
      title="Setup"
      builtBy="PROTO-009 (admin, sign-in and first-run setup)"
      route={{ search }}
    />
  );
}
