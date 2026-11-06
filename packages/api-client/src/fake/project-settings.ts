import type {
  ClinicalTemplate,
  ProjectChange,
  ProjectRole,
  SignOutRight,
} from "../generated/api.ts";
import type { PersonKey, ScenarioProject } from "./scenario.ts";
import { clinicalProject, clinicalRoles, signRights } from "./scenario-clinical.ts";
import { studyTemplates } from "./scenario-task.ts";

export type ProjectDefaults = {
  blinded: boolean;
  ai_hidden_first_read: boolean;
  study_template_id: string | null;
  clinical_template: ClinicalTemplate | null;
  match_iou: number;
  match_distance_um: number;
};

const changed = new Map<string, Partial<ProjectDefaults>>();

export const projectDefaultsOf = (project: ScenarioProject): ProjectDefaults => ({
  blinded: true,
  ai_hidden_first_read: false,
  study_template_id:
    studyTemplates.find((template) => template.name === project.studyTemplate)?.id ?? null,
  clinical_template: project.privacy === "clinical" ? "sentinel-node" : null,
  match_iou: 0.5,
  match_distance_um: 4,
  ...changed.get(project.id),
});

export const changeProjectDefaults = (project: ScenarioProject, change: ProjectChange) => {
  const kept = Object.fromEntries(
    Object.entries(change).filter(
      ([field, value]) =>
        value !== undefined && value !== null && field in projectDefaultsOf(project),
    ),
  );
  changed.set(project.id, { ...changed.get(project.id), ...kept });
};

export const clinicalRoleOf = (project: ScenarioProject, key: PersonKey): ProjectRole | null =>
  project.code === clinicalProject ? (clinicalRoles[key] ?? null) : null;

export const clinicalSignOutOf = (key: PersonKey): SignOutRight =>
  clinicalRoles[key] === "viewer" ? "never" : (signRights[key] ?? "never");

export const setClinicalSignOut = (key: PersonKey, right: SignOutRight) => {
  signRights[key] = right;
};
