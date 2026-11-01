import {
  type Project,
  type ProjectClass,
  useGetOpinionForm,
  useGetProjectImports,
  useGetProjectOverview,
  useListClassMappings,
  useListProjectClasses,
  useListStudyTemplates,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { Person } from "@parfocal/ui/components/person";
import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";
import { Switch } from "@parfocal/ui/components/switch";
import { Hint, Zone, Zones } from "@parfocal/ui/components/zone";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { okData } from "../placeholder.tsx";
import { AddClassModal } from "./add-class-modal.tsx";
import type { NewClass } from "./model.ts";
import { usePeople } from "./people.ts";

const kindText = { scale: "1 to 5", choice: "choice", yesno: "yes or no", text: "text" } as const;

const studyKindText: Record<string, string> = {
  "regions-and-cells": "Regions and cells",
  regions: "Regions",
  outlines: "Outlines",
  cells: "Cells",
  "reviewers-first": "Reviewers first",
  other: "Other",
};

function ToggleRow({
  title,
  detail,
  defaultOn,
}: {
  title: string;
  detail: string;
  defaultOn: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1.5">
      <span className="grid gap-0.5">
        <b className="text-body-sm font-semibold text-fg">{title}</b>
        <small className="text-body-sm text-fg-dim">{detail}</small>
      </span>
      <Switch checked={on} onCheckedChange={setOn} aria-label={title} />
    </label>
  );
}

function ClassRow({
  item,
  note,
}: {
  item: Pick<ProjectClass, "name" | "colour" | "key">;
  note: string;
}) {
  return (
    <div className="grid grid-cols-[12px_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-line py-1.5 text-body-sm [&+&]:border-t">
      <span className="size-3 rounded-[3px]" style={{ background: item.colour }} />
      <b className="font-medium text-fg">{item.name}</b>
      <span className="text-fg-dim">{note}</span>
      <Keycap keys={String(item.key)} size="sm" />
    </div>
  );
}

export function SettingsTab({
  project,
  addClass,
  toast,
}: {
  project: Project;
  addClass: boolean;
  toast: (message: ReactNode, onUndo?: () => void) => void;
}) {
  const navigate = useNavigate();
  const people = usePeople();
  const overview = useGetProjectOverview(project.id).data?.data;
  const classes = okData(useListProjectClasses(project.id).data) ?? [];
  const mappings = okData(useListClassMappings(project.id).data) ?? [];
  const templates = (okData(useListStudyTemplates().data) ?? []).filter(
    (template) => template.retired_at === null,
  );
  const form = okData(useGetOpinionForm(project.id).data);
  const imports = useGetProjectImports(project.id).data?.data;
  const [template, setTemplate] = useState<string | undefined>(undefined);
  const [extra, setExtra] = useState<NewClass[]>([]);
  const chosen = template ?? overview?.study_template_id ?? templates[0]?.id ?? "";
  const clinical = project.privacy_mode === "clinical";
  const taxonomy = project.template === "cell-review" ? "PanNuke" : "Sentinel node";
  const owner = project.members.find((member) => member.role === "owner");
  const closeModal = () =>
    void navigate({
      to: "/projects/$projectId",
      params: { projectId: project.id },
      search: { tab: "settings" },
    });
  const remembered = mappings
    .map((mapping) => {
      const target = classes.find((item) => item.id === mapping.class_id);
      return target ? `${mapping.source_name} → ${target.name}` : null;
    })
    .filter(Boolean)
    .join(", ");
  return (
    <div
      className="grid grid-cols-2 items-start gap-(--space-zone) pb-1.5"
      data-testid="project-settings"
    >
      <Zones>
        <Zone title="Privacy">
          <div className="flex items-start gap-2 text-body-sm text-fg">
            <Icon name="shield" className="mt-0.5 text-fg-dim" />
            <span>
              <b>{clinical ? "Clinical" : "De-identified"}</b> ·{" "}
              {clinical
                ? "Patient fields allowed, all optional. Every access is logged."
                : "No patient fields anywhere. Names are removed from file metadata and labels on upload."}
            </span>
          </div>
          <Hint>Set when the project was created.</Hint>
        </Zone>
        <Zone title="Review defaults" end={<Hint>each task can change them</Hint>}>
          <div className="grid">
            <ToggleRow
              title="Blind review"
              detail="Reviewers see each other only after they submit."
              defaultOn
            />
            <ToggleRow
              title="Hide the AI for a first read"
              detail="Reviewers mark the slide first, then the AI result is shown."
              defaultOn={false}
            />
          </div>
        </Zone>
        <Zone title="Study template" sub="Fills in a new review task and lays out its report.">
          <RadioGroup
            aria-label="Study template"
            value={chosen}
            onValueChange={(value) => setTemplate(String(value))}
          >
            {templates.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-center gap-2.5 py-1 text-body-sm text-fg"
              >
                <RadioGroupItem value={item.id} />
                <span>
                  {item.name} v{item.version}
                  <small className="ml-2 text-caption text-fg-faint">
                    {studyKindText[item.study_kind] ?? ""}
                  </small>
                </span>
              </label>
            ))}
          </RadioGroup>
        </Zone>
        <Zone
          title="Automatic imports"
          sub="Slides and results can arrive from a webhook, the API or a watched folder, with the same checks as an upload."
        >
          <div className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 rounded-ctl border border-line bg-surf-field px-3.5 py-3">
            <Icon name="link" className="text-fg-dim" />
            <span>
              <b className="block text-body-sm">
                {imports?.webhook.on ? "1 webhook connected" : "Nothing connected"}
              </b>
              {imports?.last_arrival ? (
                <small className="block text-body-sm leading-[1.45] text-fg-dim">
                  Last arrival today {imports.last_arrival.at}, {imports.last_arrival.what}
                </small>
              ) : null}
            </span>
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link
                  to="/projects/$projectId/upload"
                  params={{ projectId: project.id }}
                  search={{ scene: "api" }}
                />
              }
            >
              Manage
            </Button>
          </div>
        </Zone>
      </Zones>
      <Zones>
        <Zone
          title={
            <>
              Classes <span className="ml-2 font-normal text-fg-dim">{taxonomy}</span>
            </>
          }
          end={
            <Link
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              search={{ tab: "settings", modal: "addcls" }}
              className="text-body-sm font-medium text-accent hover:underline"
            >
              Add a class
            </Link>
          }
        >
          <div className="grid" data-testid="project-classes">
            {classes.map((item) => (
              <ClassRow
                key={item.id}
                item={item}
                note={item.name === "Tumor" ? "T regions, C cells" : "C cells"}
              />
            ))}
            {extra.map((item) => (
              <ClassRow key={item.name} item={item} note="C cells · added by you" />
            ))}
          </div>
          {remembered ? <Hint>Remembered from imports: {remembered}</Hint> : null}
        </Zone>
        <Zone
          title="Opinion form"
          sub="Asked once per slide, after the objects."
          end={
            <Link to="/admin" className="text-body-sm font-medium text-accent hover:underline">
              Edit the form
            </Link>
          }
        >
          <ol className="m-0 grid list-none gap-2 p-0">
            {(form?.questions ?? []).map((question, index) => (
              <li
                key={question.key}
                className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-baseline gap-2.5 text-body-sm text-fg"
              >
                <span className="font-mono text-fg-faint">{index + 1}</span>
                <span>{question.label}</span>
                <small className="text-caption text-fg-faint">{kindText[question.kind]}</small>
              </li>
            ))}
          </ol>
        </Zone>
        <Zone
          title="Members"
          end={
            <Link to="/admin" className="text-body-sm font-medium text-accent hover:underline">
              Invite people
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {project.members.map((member) => (
              <Person
                key={member.user_id}
                person={people.byId(member.user_id)}
                size={28}
                sub={member.user_id === owner?.user_id ? "Owner" : "Reviewer"}
              />
            ))}
          </div>
        </Zone>
      </Zones>
      <AddClassModal
        open={addClass}
        projectCode={project.code}
        taken={[...classes, ...extra]}
        onClose={closeModal}
        onAdd={(item) => {
          const before = extra;
          setExtra([...extra, item]);
          closeModal();
          toast(`${item.name} is a class in ${project.code}, on key ${item.key}`, () =>
            setExtra(before),
          );
        }}
      />
    </div>
  );
}
