import {
  getGetMySettingLayersQueryKey,
  getListStudyTemplatesQueryKey,
  type LabSettings,
  type StudyTemplateSummary,
  useGetMySettingLayers,
  useListStudyTemplates,
  useRestoreStudyTemplate,
  useRetireStudyTemplate,
  useSetWorkspaceSettings,
} from "@parfocal/api-client";
import { NameCell } from "@parfocal/ui/components/admin";
import { Button } from "@parfocal/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { CategoryTag, StatusTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { blockCopy } from "@parfocal/ui/lib/report-editor-model";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LazySavedTemplatePdf } from "../evaluation/pdf-overlay-lazy.tsx";
import { okData } from "../placeholder.tsx";
import { InfoLine, type Notify, tableClass } from "./common.tsx";
import {
  keyedBlocks,
  kindLabel,
  nameProblem,
  presetsText,
  problemTitle,
  type StudyKind,
  studyKinds,
  type TemplateDraft,
} from "./template-model.ts";

export { blockCopy, type TemplateDraft };

const emptyLab: LabSettings = { values: {}, locked: [] };

function PdfDialog({
  template,
  onClose,
}: {
  template: StudyTemplateSummary | null;
  onClose: () => void;
}) {
  if (template === null) return null;
  return <LazySavedTemplatePdf key={template.id} templateId={template.id} onClose={onClose} />;
}

export function TemplatesSection({
  notify,
  creating,
  setCreating,
  onOpen,
}: {
  notify: Notify;
  creating: boolean;
  setCreating: (open: boolean) => void;
  onOpen: (template: StudyTemplateSummary | TemplateDraft) => void;
}) {
  const templates = okData(useListStudyTemplates().data) ?? [];
  const lab = okData(useGetMySettingLayers().data)?.lab ?? emptyLab;
  const queryClient = useQueryClient();
  const retire = useRetireStudyTemplate();
  const restore = useRestoreStudyTemplate();
  const setting = useSetWorkspaceSettings();
  const [preview, setPreview] = useState<StudyTemplateSummary | null>(null);
  const stored = lab.values["default_study_template"];
  const defaultId = typeof stored === "string" ? stored : null;
  const builtIn = templates.filter((template) => template.built_in !== null).length;
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListStudyTemplatesQueryKey() });
  const retireOrRestore = (template: StudyTemplateSummary) => {
    const off = template.retired_at !== null;
    const run = off ? restore : retire;
    run.mutate(
      { templateId: template.id },
      {
        onSuccess: (response) => {
          if (response.status >= 300) {
            notify(problemTitle(response.data));
            return;
          }
          void refresh();
          notify(
            off
              ? `${template.name} is back`
              : `${template.name} is retired. New tasks can't pick it, tasks that use it keep it.`,
            () => {
              (off ? retire : restore).mutate(
                { templateId: template.id },
                { onSuccess: () => void refresh() },
              );
            },
          );
        },
      },
    );
  };
  const makeDefault = (template: StudyTemplateSummary) => {
    const was = defaultId;
    const apply = (value: string | null, said?: string, undo?: () => void) =>
      setting.mutate(
        { data: { values: { default_study_template: value }, locked: lab.locked } },
        {
          onSuccess: (response) => {
            if (response.status >= 300) {
              notify(problemTitle(response.data));
              return;
            }
            void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() });
            if (said) notify(said, undo);
          },
        },
      );
    apply(template.id, `${template.name} is now the default for new projects`, () => apply(was));
  };
  return (
    <>
      <Zone
        title="Study templates"
        sub="A template lays out the evaluation report as blocks on pages and fills in what a new review task checks, its opinion form and how it runs. Researchers pick one when they create a task, and can still arrange one task's report on its own."
        end={
          <span className="text-body-sm text-fg-dim">
            {builtIn} come with Parfocal, {templates.length - builtIn} made here
          </span>
        }
      >
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>Template</TableHead>
              <TableHead>Report blocks, in order</TableHead>
              <TableHead>Fills in for a new task</TableHead>
              <TableHead className="text-right">Tasks</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((template) => {
              const off = template.retired_at !== null;
              const own = template.built_in === null;
              return (
                <TableRow key={template.id} className={off ? "opacity-55" : ""}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <NameCell
                        lead={<Icon name="file" />}
                        title={template.name}
                        version={`v${template.version}`}
                        sub={`${kindLabel(template.study_kind)} · ${own ? "made here" : "comes with Parfocal"}`}
                      />
                      {defaultId === template.id ? (
                        <StatusTag tone="accent">Default</StatusTag>
                      ) : null}
                      {off ? <StatusTag>Retired</StatusTag> : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {keyedBlocks(template.blocks).map(({ block, key }) => (
                        <CategoryTag key={key} title={blockCopy[block.kind].shows}>
                          {block.title}
                        </CategoryTag>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-55 whitespace-normal text-fg-dim">
                    {presetsText(template)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{template.task_count}</TableCell>
                  <TableCell>
                    <span className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Preview ${template.name}`}
                        onClick={() => setPreview(template)}
                      >
                        <Icon name="eye" />
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        aria-label={`${own ? "Edit" : "Duplicate"} ${template.name}`}
                        onClick={() => onOpen(template)}
                      >
                        {own ? "Edit" : "Duplicate"}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`More for ${template.name}`}
                            />
                          }
                        >
                          <Icon name="more" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => setPreview(template)}>
                            Preview the PDF
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onOpen(template)}>
                            {own ? "Edit" : "Duplicate and edit"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={off || defaultId === template.id}
                            onClick={() => makeDefault(template)}
                          >
                            Use for new projects
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => retireOrRestore(template)}>
                            {off ? "Restore" : "Retire"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Zone>
      <InfoLine>
        Templates that come with Parfocal stay as they are. Duplicate one to change it. A task keeps
        the version it was created with, and a signed report keeps its layout.
      </InfoLine>
      <PdfDialog template={preview} onClose={() => setPreview(null)} />
      <NewTemplateModal
        open={creating}
        templates={templates}
        onClose={() => setCreating(false)}
        onCreate={(draft) => {
          setCreating(false);
          onOpen(draft);
          notify(
            draft.from === null
              ? "An empty template. Drag blocks onto the page."
              : "A copy to change. Name, paper and format are on the right.",
          );
        }}
      />
    </>
  );
}

function NewTemplateModal({
  open,
  templates,
  onClose,
  onCreate,
}: {
  open: boolean;
  templates: StudyTemplateSummary[];
  onClose: () => void;
  onCreate: (draft: TemplateDraft) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StudyKind>("regions-and-cells");
  const [from, setFrom] = useState<"blank" | "tpl">("blank");
  const [base, setBase] = useState("");
  const [paper, setPaper] = useState<TemplateDraft["paper"]>("a4");
  const [tried, setTried] = useState(false);
  const trimmed = name.trim();
  const error = nameProblem(name, templates);
  const basis = base || templates[0]?.id || "";
  const reset = () => {
    setName("");
    setFrom("blank");
    setTried(false);
  };
  return (
    <SmallModal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
      title="New study template"
      width={560}
      hint="Opens in the editor."
      primaryLabel="Create and open"
      blockers={tried && error ? [{ id: "name", text: error, goTo: "Go to the name" }] : []}
      blockersTitle="Before you can create it"
      onPrimary={() => {
        setTried(true);
        if (error) return;
        onCreate({ name: trimmed, kind, from: from === "blank" ? null : basis || null, paper });
        reset();
      }}
    >
      <FormField
        label="Name"
        help="Researchers see it when they create a review task."
        error={tried ? error : undefined}
      >
        <TextFieldInput
          placeholder="For example, Lymph node detection"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <div className="grid gap-1.5">
        <span className="text-body-sm font-semibold">Kind of study</span>
        <Select value={kind} onValueChange={(value) => setKind(value as StudyKind)}>
          <SelectTrigger aria-label="Kind of study" className="w-full">
            <SelectValue>{kindLabel(kind)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {studyKinds.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <span id="template-from" className="text-body-sm font-semibold">
          Start from
        </span>
        <RadioGroup
          aria-labelledby="template-from"
          value={from}
          onValueChange={(value) => setFrom(value as "blank" | "tpl")}
          className="grid gap-2"
        >
          {[
            ["blank", "An empty page", "Only the header and footer. You add the blocks."],
            ["tpl", "A template", "A copy of one from the library, to change."],
          ].map(([value, label, detail]) => (
            <label key={value} className="flex cursor-pointer items-start gap-2.5 text-body-sm">
              <RadioGroupItem value={String(value)} className="mt-0.5" />
              <span>
                <b className="block font-medium">{label}</b>
                <small className="text-caption text-fg-dim">{detail}</small>
              </span>
            </label>
          ))}
        </RadioGroup>
        {from === "tpl" ? (
          <Select value={basis} onValueChange={(value) => setBase(String(value))}>
            <SelectTrigger aria-label="Template to copy" className="w-full">
              <SelectValue>
                {templates.find((item) => item.id === basis)?.name ?? "Pick a template"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {templates.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} v{item.version} · {item.blocks.length} blocks
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <span id="template-paper" className="text-body-sm font-semibold">
          Paper
        </span>
        <SegmentedControl
          aria-labelledby="template-paper"
          value={paper}
          onValueChange={(value) => setPaper(value as TemplateDraft["paper"])}
          options={[
            { value: "a4", label: "A4" },
            { value: "letter", label: "US Letter" },
          ]}
        />
      </div>
    </SmallModal>
  );
}
