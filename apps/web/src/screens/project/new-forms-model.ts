import {
  ApiError,
  type CaseDraft,
  type Project,
  type ProjectDraft,
  type TaxonomyTemplate,
  type Template,
} from "@parfocal/api-client";
import type { NewCaseValues, NewProjectValues, TaxonomyOption } from "@parfocal/ui/lib/new-forms";

const taxonomyNames: Record<TaxonomyTemplate, string> = {
  "sentinel-node": "Sentinel node",
  pannuke: "PanNuke",
};

export const nextCode = (projects: Pick<Project, "number">[]) =>
  `P${String(Math.max(0, ...projects.map((project) => project.number)) + 1).padStart(2, "0")}`;

export const taxonomyOptions = (templates: Template[]): TaxonomyOption[] =>
  templates.map((template) => ({
    id: template.template,
    name: taxonomyNames[template.template],
    classes: template.classes,
  }));

export const projectDraft = (values: NewProjectValues): ProjectDraft => ({
  name: values.name,
  privacy_mode: values.privacy,
  template: values.template,
  taxonomy: values.taxonomy as TaxonomyTemplate,
});

export const caseDraft = (projectId: string, values: NewCaseValues): CaseDraft => ({
  project_id: projectId,
  label: values.label,
  specimens: values.specimen === "" ? [] : [{ letter: "A", type: values.specimen }],
  ...(values.patient
    ? {
        patient: {
          name: values.patient.name,
          ...(values.patient.birthNumber === "" ? {} : { mrn: values.patient.birthNumber }),
        },
      }
    : {}),
});

export const failureText = (error: unknown): { failure?: string } => {
  if (error === null || error === undefined) return {};
  if (error instanceof ApiError && error.kind !== "network") return { failure: error.message };
  return { failure: "Could not reach the server. Try again." };
};
