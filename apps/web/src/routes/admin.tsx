import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";

const adminSearch = z.object({
  section: z.enum(["members", "invitations", "audit", "retention", "security"]).default("members"),
});

export const Route = createFileRoute("/admin")({
  validateSearch: adminSearch,
  component: Admin,
});

function Admin() {
  const search = Route.useSearch();
  return (
    <Placeholder
      title="Admin"
      builtBy="PROTO-009 (admin, sign-in and first-run setup)"
      route={{ search }}
    />
  );
}
