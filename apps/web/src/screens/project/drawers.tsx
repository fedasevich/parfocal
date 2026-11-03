import {
  type Project,
  useCreateCase,
  useCreateProject,
  useListProjects,
  useListTaxonomyTemplates,
} from "@parfocal/api-client";
import { NewCaseForm, NewProjectForm } from "@parfocal/ui/components/new-forms";
import { useQueryClient } from "@tanstack/react-query";
import { okData } from "../placeholder.tsx";
import {
  caseDraft,
  failureText,
  nextCode,
  projectDraft,
  taxonomyOptions,
} from "./new-forms-model.ts";

export function NewProjectDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const queryClient = useQueryClient();
  const projects = okData(useListProjects().data) ?? [];
  const taxonomies = taxonomyOptions(okData(useListTaxonomyTemplates().data) ?? []);
  const create = useCreateProject();
  return (
    <NewProjectForm
      code={nextCode(projects)}
      taxonomies={taxonomies}
      pending={create.isPending}
      {...failureText(create.error)}
      onClose={onClose}
      onCreate={(values) =>
        create.mutate(
          { data: projectDraft(values) },
          {
            onSuccess: (response) => {
              if (response.status !== 201) return;
              void queryClient.invalidateQueries().then(() => onCreated(response.data));
            },
          },
        )
      }
    />
  );
}

export function NewCaseDrawer({
  project,
  onClose,
  onCreated,
}: {
  project: Project;
  onClose: () => void;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const create = useCreateCase();
  return (
    <NewCaseForm
      project={{ code: project.code, name: project.name, privacy: project.privacy_mode }}
      pending={create.isPending}
      {...failureText(create.error)}
      onClose={onClose}
      onCreate={(values) =>
        create.mutate(
          { data: caseDraft(project.id, values) },
          {
            onSuccess: (response) => {
              if (response.status !== 201) return;
              void queryClient.invalidateQueries().then(onCreated);
            },
          },
        )
      }
    />
  );
}
