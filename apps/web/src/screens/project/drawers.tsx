import {
  type Project,
  useGetMe,
  useListProjects,
  useListStudyTemplates,
  useListTaxonomyTemplates,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { DrawerPanel } from "@parfocal/ui/components/drawer-panel";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { Person } from "@parfocal/ui/components/person";
import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";
import { TokenField, type TokenItem } from "@parfocal/ui/components/token-field";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { useState } from "react";
import { okData } from "../placeholder.tsx";
import { toPersonInfo, usePeople } from "./people.ts";

const studyKindText: Record<string, string> = {
  "regions-and-cells": "Regions and cells",
  regions: "Regions",
  outlines: "Outlines",
  cells: "Cells",
  "reviewers-first": "Reviewers first",
  other: "Other",
};

function RadioRow({ value, title, text }: { value: string; title: string; text?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <RadioGroupItem value={value} className="mt-0.5" />
      <span className="grid gap-0.5">
        <b className="text-body-sm font-semibold text-fg">{title}</b>
        {text ? <small className="text-body-sm text-fg-dim">{text}</small> : null}
      </span>
    </label>
  );
}

const nextCode = (projects: Pick<Project, "number">[]) =>
  `P${String(Math.max(0, ...projects.map((project) => project.number)) + 1).padStart(2, "0")}`;

export function NewProjectDrawer({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: () => void;
}) {
  const me = okData(useGetMe().data);
  const projects = okData(useListProjects().data) ?? [];
  const templates = (okData(useListStudyTemplates().data) ?? []).filter(
    (template) => template.retired_at === null,
  );
  const taxonomy = (okData(useListTaxonomyTemplates().data) ?? []).find(
    (template) => template.template === "sentinel-node",
  );
  const people = usePeople();
  const [privacy, setPrivacy] = useState("de-identified");
  const [template, setTemplate] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<string[] | undefined>(undefined);
  const [invites, setInvites] = useState<string[]>([]);
  const others = people.members.filter((member) => member.user_id !== me?.user_id);
  const firstOther = others.find((member) => member.initials === "SM") ?? others[0];
  const chosen = picked ?? (firstOther ? [firstOther.user_id] : []);
  const items: TokenItem[] = [
    ...others.map((member) => ({
      id: member.user_id,
      name: member.display_name,
      person: toPersonInfo(member),
      ...(member.title ? { sub: member.title } : {}),
    })),
    ...invites.map((email) => ({ id: email, name: email, end: "invited" })),
  ];
  const ownTemplate = template ?? templates[0]?.id ?? "";
  const count = 1 + chosen.length;
  return (
    <DrawerPanel
      label="New project"
      title="New project"
      hint={`${nextCode(projects)} when created`}
      width={560}
      testId="project-drawer"
      onClose={onClose}
      footer={
        <>
          <Hint>Settings can change later</Hint>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onCreate}>
            Create and upload
          </Button>
        </>
      }
    >
      <Zone title="Name">
        <FormField label={<span className="sr-only">Name</span>}>
          <TextFieldInput autoFocus defaultValue="Sentinel nodes, model B validation" />
        </FormField>
      </Zone>
      <Zone title="Privacy">
        <RadioGroup
          aria-label="Privacy"
          value={privacy}
          onValueChange={(value) => setPrivacy(String(value))}
          className="gap-2.5"
        >
          <RadioRow
            value="de-identified"
            title="De-identified"
            text="No patient fields. Names are stripped from files on upload."
          />
          <RadioRow
            value="clinical"
            title="Clinical"
            text="Patient fields allowed and optional. Access is logged."
          />
        </RadioGroup>
      </Zone>
      <Zone title="Study template" sub="Fills in a new review task and lays out its report.">
        <RadioGroup
          aria-label="Study template"
          value={ownTemplate}
          onValueChange={(value) => setTemplate(String(value))}
          className="gap-2.5"
        >
          {templates.map((item) => (
            <RadioRow
              key={item.id}
              value={item.id}
              title={`${item.name} v${item.version}`}
              text={studyKindText[item.study_kind] ?? ""}
            />
          ))}
        </RadioGroup>
        <div className="flex flex-wrap gap-x-4.5 gap-y-2 text-body-sm text-fg">
          {(taxonomy?.classes ?? []).map((item) => (
            <span key={item.key} className="inline-flex items-center gap-2">
              <i className="size-3 rounded-[3px]" style={{ background: item.colour }} />
              {item.name}
              <Keycap keys={String(item.key)} size="sm" />
            </span>
          ))}
        </div>
        <Hint>Classes come from the template. Imports map their own class names to these.</Hint>
      </Zone>
      <Zone title="Members" end={<Hint>{`${count} member${count === 1 ? "" : "s"}`}</Hint>}>
        <div className="flex flex-wrap items-center gap-x-4.5 gap-y-2.5">
          {me ? <Person person={people.byId(me.user_id)} size={24} sub="You, the owner" /> : null}
        </div>
        <TokenField
          label="Members"
          items={items}
          picked={[...chosen, ...invites]}
          onPickedChange={(ids) => {
            setPicked(ids.filter((id) => !invites.includes(id)));
            setInvites(invites.filter((email) => ids.includes(email)));
          }}
          onInvite={(email) => setInvites([...invites, email.trim().toLowerCase()])}
          placeholder="Type a name or an email"
        />
        <Hint>People in the workspace, or an email to invite someone new.</Hint>
      </Zone>
    </DrawerPanel>
  );
}

export function NewCaseDrawer({ project, onClose }: { project: Project; onClose: () => void }) {
  const clinical = project.privacy_mode === "clinical";
  return (
    <DrawerPanel
      label="New case"
      title="New case"
      hint={`in ${project.code} · ${project.name}`}
      width={520}
      testId="project-drawer"
      onClose={onClose}
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onClose}>
            Create case
          </Button>
        </>
      }
    >
      <Hint className="mx-0.5">
        A case is optional. It groups the slides of one specimen so they are reviewed together.
        Slides can also stay loose in the project.
      </Hint>
      <Zone title="Case">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Case ID" help="from the file names">
            <TextFieldInput autoFocus defaultValue="S26-04830" className="font-mono" />
          </FormField>
          <FormField label="Specimen">
            <TextFieldInput defaultValue="Sentinel lymph node, left" />
          </FormField>
        </div>
      </Zone>
      <Zone title="Patient" end={<Hint>optional</Hint>} data-testid="case-patient">
        {clinical ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Name">
                <TextFieldInput placeholder="Not entered" />
              </FormField>
              <FormField label="Birth number">
                <TextFieldInput placeholder="Not entered" />
              </FormField>
            </div>
            <Hint>
              This is a clinical project. Names can be hidden for everyone in Settings, and opening
              them is logged.
            </Hint>
          </>
        ) : (
          <>
            <div className="flex min-h-8 items-center gap-2 rounded-ctl border border-dashed border-line-strong bg-chrome-2 px-2.5 text-body-sm text-fg-dim">
              <Icon name="shield" />
              <span>Off in a de-identified project</span>
            </div>
            <Hint>The project owner can switch to clinical in project settings.</Hint>
          </>
        )}
      </Zone>
      <Zone title="Slides">
        <div className="grid grid-cols-[30px_1fr_auto] items-center gap-3 rounded-xl border-2 border-dashed border-accent bg-accent-soft p-4">
          <Icon name="upload" size="md" className="text-accent" />
          <span>
            <b className="block text-body">Drop slides and their results</b>
            <small className="block text-body-sm leading-[1.45] text-fg-dim">
              They go into this case and pair by name
            </small>
          </span>
          <Button>Choose files</Button>
        </div>
      </Zone>
    </DrawerPanel>
  );
}
