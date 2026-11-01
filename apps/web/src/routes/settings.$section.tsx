import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";

export const settingsSections = [
  "profile",
  "appearance",
  "viewer",
  "shortcuts",
  "notifications",
  "sessions",
] as const;

const sectionSchema = z.enum(settingsSections);

export const Route = createFileRoute("/settings/$section")({
  params: {
    parse: ({ section }) => {
      const parsed = sectionSchema.safeParse(section);
      if (!parsed.success) throw notFound();
      return { section: parsed.data };
    },
    stringify: ({ section }) => ({ section }),
  },
  component: Settings,
});

function Settings() {
  const params = Route.useParams();
  return (
    <Placeholder
      title="Settings"
      builtBy="PROTO-016 (settings, shortcuts and developer mode)"
      route={{ params }}
    />
  );
}
