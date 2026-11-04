import type { SearchHit } from "@parfocal/api-client";
import type { IconName } from "@parfocal/ui/components/icon";
import { destinations } from "./destinations.ts";

export const hitIcons: Record<SearchHit["kind"], IconName> = {
  project: "folder",
  case: "file",
  slide: "slides",
  object: "target",
  person: "user",
  "patient-case": "file",
};

export function hitHref(hit: SearchHit): string | null {
  const projectId = hit.project?.id;
  if (hit.kind === "project") return destinations.project(hit.id);
  if ((hit.kind === "slide" || hit.kind === "object") && projectId && hit.slide_id) {
    return destinations.slide(projectId, hit.slide_id, undefined, hit.object_id ?? undefined);
  }
  if (hit.kind === "case" && projectId) return destinations.project(projectId);
  return null;
}

export const searchScopes = [
  { value: "all", label: "All" },
  { value: "projects", label: "Projects" },
  { value: "cases", label: "Cases" },
  { value: "slides", label: "Slides" },
  { value: "objects", label: "Object IDs" },
  { value: "people", label: "People" },
  { value: "actions", label: "Actions" },
] as const;

export type SearchPageScope = (typeof searchScopes)[number]["value"];

export const hitGroups = [
  { title: "Projects", kinds: ["project"] },
  { title: "Cases", kinds: ["case", "patient-case"] },
  { title: "Slides", kinds: ["slide"] },
  { title: "Object IDs", kinds: ["object"] },
  { title: "People", kinds: ["person"] },
] as const satisfies readonly { title: string; kinds: readonly SearchHit["kind"][] }[];
