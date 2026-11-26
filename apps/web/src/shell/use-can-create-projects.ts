import { useGetMe } from "@parfocal/api-client";
import { okData } from "../screens/placeholder.tsx";
import { canCreateProjects } from "./project-creation.ts";

export function useCanCreateProjects(): boolean {
  return canCreateProjects(okData(useGetMe().data));
}
