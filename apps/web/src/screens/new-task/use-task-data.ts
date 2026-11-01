import {
  type ResultSet,
  type StudyTemplateSummary,
  useGetProject,
  useGetProjectScopeOptions,
  useGetReviewTaskDefaults,
  useListAvailability,
  useListProjectResultSets,
  useListProjectSlides,
  useListReviewerWorkload,
  useListStudyTemplateReviewDefaults,
  useListStudyTemplates,
  useListTenantMembers,
} from "@parfocal/api-client";
import { avatarColour } from "@parfocal/ui/lib/avatar-colours";
import { okData } from "../placeholder.tsx";
import {
  andJoin,
  type ReminderKey,
  type ResultSetChoice,
  reminderChoices,
  type SlideChoice,
  type SlideGroup,
  shortDate,
  type TaskData,
  type TemplateChoice,
} from "./model.ts";

const studyKinds: Record<string, string> = {
  "regions-and-cells": "Regions and cells",
  regions: "Regions",
  outlines: "Outlines",
  cells: "Cells",
  "reviewers-first": "Reviewers first",
  other: "Other",
};

const resultSetKeys = ["cam", "sam"] as const;

function toResultSet(set: ResultSet, index: number): ResultSetChoice {
  const brand = set.name.split(" ")[0] ?? set.name;
  const version = set.model_version ?? "";
  const date = shortDate(set.produced_at ?? set.created_at);
  return {
    id: set.id,
    key: resultSetKeys[index] ?? "sam",
    label: `${set.name} ${version}`.trim(),
    short: `${brand} ${version}`.trim(),
    detail:
      set.source === "import"
        ? `Imported ${date} from ${set.source_file ?? "a file"}`
        : `Run here ${date}`,
  };
}

function toGroups(
  slides: SlideChoice[],
  picked: string[],
): { groups: SlideGroup[]; pool: string[] } {
  const groups: SlideGroup[] = [];
  for (const slide of slides.filter((candidate) => picked.includes(candidate.id))) {
    const key = slide.caseLabel ?? "loose";
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      group = {
        key,
        title: slide.caseLabel ? `Case ${slide.caseLabel}` : "Loose slides",
        sub: "",
        slideIds: [],
      };
      groups.push(group);
    }
    group.slideIds.push(slide.id);
  }
  return {
    groups: groups.map((group) => ({
      ...group,
      sub:
        group.key === "loose"
          ? andJoin(group.slideIds.map((id) => slides.find((slide) => slide.id === id)?.name ?? id))
          : group.sub,
    })),
    pool: slides.filter((slide) => !picked.includes(slide.id)).map((slide) => slide.id),
  };
}

const reminderOf = (days: number[]): ReminderKey =>
  reminderChoices.find((choice) => choice.days.join() === days.join())?.key ?? "none";

export function useTaskData(projectId: string): {
  data: TaskData | undefined;
  pending: boolean;
  failed: boolean;
} {
  const queries = {
    project: useGetProject(projectId),
    defaults: useGetReviewTaskDefaults(projectId),
    slides: useListProjectSlides(projectId),
    resultSets: useListProjectResultSets(projectId),
    templates: useListStudyTemplates(),
    templateDefaults: useListStudyTemplateReviewDefaults(),
    members: useListTenantMembers(),
    availability: useListAvailability(),
    workload: useListReviewerWorkload(),
    scopeOptions: useGetProjectScopeOptions(projectId),
  };
  const all = Object.values(queries);
  const pending = all.some((query) => query.isPending);
  const failed = all.some((query) => query.isError);
  const project = okData(queries.project.data);
  const defaults = queries.defaults.data?.data;
  const projectSlides = queries.slides.data?.data;
  const resultSets = okData(queries.resultSets.data);
  const templates = okData(queries.templates.data);
  const templateDefaults = queries.templateDefaults.data?.data;
  const members = okData(queries.members.data);
  const availability = okData(queries.availability.data) ?? [];
  const workload = queries.workload.data?.data;
  const scopeOptions = queries.scopeOptions.data?.data;
  if (
    !project ||
    !defaults ||
    !projectSlides ||
    !resultSets ||
    !templates ||
    !templateDefaults ||
    !members ||
    !workload ||
    !scopeOptions
  ) {
    return { data: undefined, pending, failed };
  }
  const slides: SlideChoice[] = projectSlides.map((slide) => ({
    id: slide.id,
    name: slide.case ? `${slide.label} · ${slide.stain}` : slide.label,
    caseLabel: slide.case?.label ?? null,
    sets: slide.result_set_ids,
  }));
  const { groups, pool } = toGroups(slides, defaults.slide_ids);
  for (const group of groups) {
    const specimen = projectSlides.find((slide) => slide.case?.label === group.key)?.case?.specimen;
    if (specimen) group.sub = specimen;
  }
  const choices: TemplateChoice[] = templates.flatMap((template: StudyTemplateSummary) => {
    const extra = templateDefaults.templates.find((item) => item.template_id === template.id);
    if (!extra) return [];
    return [
      {
        id: template.id,
        name: template.name,
        version: `v${template.version}`,
        kind: studyKinds[template.study_kind] ?? "Other",
        retired: template.retired_at !== null,
        preset: {
          scope: extra.scope_kinds,
          scopeOptions: {
            cells: extra.scope_options.cells,
            low: extra.scope_options.low,
            roi: extra.scope_options.rois,
            unsure: extra.scope_options.unsure_zones,
          },
          decision: {
            kind: extra.decision.kind,
            agreeFrom: extra.decision.agree_from,
            disagreeTo: extra.decision.disagree_to,
          },
          display: extra.display,
          form: extra.opinion_form,
          blind: template.presets.blinding ?? true,
          hide: template.presets.first_read ?? false,
          start: template.presets.start_mode === "viewer" ? "full" : "guided",
          split: template.presets.split === "even" ? "even" : "all",
        },
      },
    ];
  });
  const awayUntil = new Map(
    availability.filter((item) => item.status === "away").map((item) => [item.user_id, item.until]),
  );
  const people = workload.flatMap((load) => {
    const member = members.find((candidate) => candidate.user_id === load.user_id);
    if (!member) return [];
    const until = awayUntil.get(member.user_id);
    return [
      {
        id: member.user_id,
        name: member.display_name,
        initials: member.initials,
        colour: avatarColour(member.avatar_colour),
        title: member.title ?? "",
        openTasks: load.open_tasks,
        awayUntil: until ? shortDate(until) : null,
      },
    ];
  });
  const data: TaskData = {
    code: defaults.code,
    taskId: defaults.task_id,
    projectId,
    projectName: project.name,
    today: defaults.today,
    slides,
    groups,
    pool,
    resultSets: resultSets.map(toResultSet),
    names: Object.fromEntries(defaults.names.map((item) => [item.result_set_id, item.name])),
    templates: choices,
    defaultTemplateId: defaults.study_template_id,
    people,
    rois: scopeOptions.rois,
    zones: scopeOptions.unsure_zones.map((zone) => ({
      key: zone.key,
      cells: zone.cells_per_slide,
    })),
    forms: templateDefaults.opinion_forms,
    defaults: {
      resultSetId: defaults.result_set_id,
      reviewerIds: defaults.reviewer_ids,
      due: defaults.due_on,
      reminders: reminderOf(defaults.reminder_days),
    },
  };
  return { data, pending, failed };
}
