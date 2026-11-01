import { useGetMyHome, useListTenantMembers } from "@parfocal/api-client";
import { avatarColour } from "@parfocal/ui/lib/avatar-colours";
import { useSyncExternalStore } from "react";
import { okData } from "../screens/placeholder.tsx";
import { createOriginStore } from "./origin.ts";
import type { PersonaKey } from "./review-flow.ts";
import type { ScenarioIds } from "./targets.ts";

export const originStore = createOriginStore(
  typeof sessionStorage === "undefined" ? undefined : sessionStorage,
);

export function useOrigin() {
  return useSyncExternalStore(originStore.subscribe, originStore.get);
}

export function useScenarioIds(): ScenarioIds | undefined {
  const home = okData(useGetMyHome().data);
  const resume = home?.resume;
  const clinical = home?.projects.find((project) => project.privacy_mode === "clinical");
  const clinicalSlide = clinical?.strip[0];
  if (!resume || !clinical || !clinicalSlide) return undefined;
  return {
    researchProject: resume.project.id,
    clinicalProject: clinical.id,
    task: resume.task_id,
    slide: resume.slide_id,
    clinicalSlide: clinicalSlide.id,
  };
}

export type Persona = { initials: string; name: string; color: string };

export function usePeople(): (key: PersonaKey) => Persona {
  const members = okData(useListTenantMembers().data) ?? [];
  return (key) => {
    const member = members.find((candidate) => candidate.initials === key);
    return {
      initials: key,
      name: member?.display_name ?? key,
      color: avatarColour(member?.avatar_colour ?? 0),
    };
  };
}
