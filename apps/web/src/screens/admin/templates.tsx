import {
  type StudyTemplateSummary,
  useCreateStudyTemplate,
  useEditStudyTemplate,
  useListStudyTemplates,
} from "@parfocal/api-client";
import { NameCell } from "@parfocal/ui/components/admin";
import { Button } from "@parfocal/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@parfocal/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";
import {
  BlockCatalogue,
  BlockSettings,
  type ReportBlock as PageBlock,
  ReportPagePreview,
} from "@parfocal/ui/components/report-templates";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { Switch } from "@parfocal/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@parfocal/ui/components/tabs";
import { CategoryTag, StatusTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import { useState } from "react";
import { okData } from "../placeholder.tsx";
import { InfoLine, type Notify, tableClass } from "./common.tsx";

type BlockKind = StudyTemplateSummary["blocks"][number]["kind"];

export const blockCopy: Record<BlockKind, { name: string; shows: string }> = {
  "headline-numbers": { name: "Headline numbers", shows: "The metrics you pick, as tiles" },
  "region-metrics": {
    name: "Region metrics per slide",
    shows: "Sensitivity, precision and Dice on each slide",
  },
  "confusion-matrix": {
    name: "Cell type confusion matrix",
    shows: "What the AI said against the consensus",
  },
  "reviewer-agreement": {
    name: "Agreement between reviewers",
    shows: "Cohen's κ for regions, cells and the form",
  },
  "disagreement-reasons": { name: "Why reviewers disagreed", shows: "Reason codes, largest first" },
  "opinion-answers": { name: "Opinion answers", shows: "The questions you pick from the form" },
  "worst-objects": {
    name: "Objects, worst first",
    shows: "The objects reviewers disagreed with most",
  },
  "slide-table": {
    name: "Per-slide table",
    shows: "Objects, disagreements and time on each slide",
  },
  "slide-figure": {
    name: "Slide figure",
    shows: "An object on its slide with the reviewed layer",
  },
  text: { name: "Text", shows: "Methods, notes or a caption you write" },
  comparison: { name: "Compare two result sets", shows: "This task next to a second one" },
};

const kinds: { value: StudyTemplateSummary["study_kind"]; label: string }[] = [
  { value: "regions-and-cells", label: "Regions and cells" },
  { value: "regions", label: "Regions" },
  { value: "outlines", label: "Outlines" },
  { value: "cells", label: "Cells" },
  { value: "reviewers-first", label: "Reviewers first" },
  { value: "other", label: "Other" },
];

const kindLabel = (kind: StudyTemplateSummary["study_kind"]) =>
  kinds.find((item) => item.value === kind)?.label ?? kind;

const scopeText: Record<string, string> = {
  "all-regions": "tumor regions",
  "random-cells": "a random sample of cells",
  "cells-below-score": "cells the model was least sure about",
  "inside-rois": "only inside ROIs",
  "unsure-zones": "unsure zones",
};

const splitText = {
  everyone: "everyone reviews all",
  even: "split evenly",
  chosen: "chosen per slide",
};

export const presetsText = (template: StudyTemplateSummary) => {
  const presets = template.presets;
  const scope = scopeText[presets.objects_to_check.kind] ?? presets.objects_to_check.kind;
  const read = presets.first_read
    ? "a first read without the AI"
    : (presets.blinding ?? true)
      ? "blind"
      : "open";
  const start = presets.start_mode === "viewer" ? "the full viewer" : "guided review";
  return `${scope[0]?.toUpperCase() ?? ""}${scope.slice(1)}, ${read}, ${start}, ${splitText[presets.split ?? "everyone"]}`;
};

const toPageBlocks = (template: Pick<StudyTemplateSummary, "blocks">): PageBlock[] =>
  template.blocks.map((block, index) => ({
    id: `${block.kind}-${index}`,
    name: block.title,
    shows: blockCopy[block.kind].shows,
  }));

export type TemplateDraft = {
  name: string;
  kind: StudyTemplateSummary["study_kind"];
  from: string | null;
  paper: "a4" | "letter";
};

function PdfDialog({
  template,
  onClose,
}: {
  template: StudyTemplateSummary | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={template !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-160">
        <DialogHeader>
          <DialogTitle>{template?.name} · sample PDF</DialogTitle>
          <DialogDescription>
            The exact file a task made from this template downloads, filled with the sample
            project's numbers.
          </DialogDescription>
        </DialogHeader>
        {template ? (
          <div className="grid place-items-center bg-canvas p-4">
            <ReportPagePreview title={template.name} blocks={toPageBlocks(template)} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
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
  const [retired, setRetired] = useState<Record<string, boolean>>({});
  const [preferred, setPreferred] = useState<string | null>(null);
  const [preview, setPreview] = useState<StudyTemplateSummary | null>(null);
  const defaultId = preferred ?? templates[0]?.id;
  const isRetired = (template: StudyTemplateSummary) =>
    retired[template.id] ?? template.retired_at !== null;
  const builtIn = templates.filter((template) => template.built_in !== null).length;
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
              const off = isRetired(template);
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
                      {template.blocks.map((block) => (
                        <CategoryTag
                          key={`${block.kind}:${block.title}`}
                          title={blockCopy[block.kind].shows}
                        >
                          {blockCopy[block.kind].name}
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
                      <Button size="sm" variant="ghost" onClick={() => setPreview(template)}>
                        <Icon name="eye" />
                        Preview
                      </Button>
                      <Button size="sm" onClick={() => onOpen(template)}>
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
                            onClick={() => {
                              setPreferred(template.id);
                              notify(`${template.name} is now the default for new projects`);
                            }}
                          >
                            Use for new projects
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              const next = !off;
                              setRetired({ ...retired, [template.id]: next });
                              notify(
                                next
                                  ? `${template.name} is retired. New tasks can't pick it, tasks that use it keep it.`
                                  : `${template.name} is back`,
                                () =>
                                  setRetired((current) => ({ ...current, [template.id]: !next })),
                              );
                            }}
                          >
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
  const [kind, setKind] = useState<TemplateDraft["kind"]>("regions-and-cells");
  const [from, setFrom] = useState<"blank" | "tpl">("blank");
  const [base, setBase] = useState(templates[0]?.id ?? "");
  const [paper, setPaper] = useState<TemplateDraft["paper"]>("a4");
  const [tried, setTried] = useState(false);
  const trimmed = name.trim();
  const taken = templates.find((item) => item.name.toLowerCase() === trimmed.toLowerCase());
  const error = !trimmed
    ? "Give the template a name."
    : trimmed.length < 2
      ? "Use at least 2 characters."
      : taken
        ? `A template called ${taken.name} already exists.`
        : undefined;
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
        onCreate({ name: trimmed, kind, from: from === "blank" ? null : base || null, paper });
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
        <span className="text-body-sm font-semibold text-fg">Kind of study</span>
        <Select value={kind} onValueChange={(value) => setKind(value as TemplateDraft["kind"])}>
          <SelectTrigger aria-label="Kind of study" className="w-full">
            <SelectValue>{kindLabel(kind)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {kinds.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <span id="template-from" className="text-body-sm font-semibold text-fg">
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
          <Select value={base} onValueChange={(value) => setBase(String(value))}>
            <SelectTrigger aria-label="Template to copy" className="w-full">
              <SelectValue>
                {templates.find((item) => item.id === base)?.name ?? "Pick a template"}
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
        <span id="template-paper" className="text-body-sm font-semibold text-fg">
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

type EditorBlock = { id: string; kind: BlockKind; title: string };

export function TemplateEditor({
  source,
  notify,
  onBack,
}: {
  source: StudyTemplateSummary | TemplateDraft | null;
  notify: Notify;
  onBack: () => void;
}) {
  const templates = okData(useListStudyTemplates().data) ?? [];
  const create = useCreateStudyTemplate();
  const edit = useEditStudyTemplate();
  const fallback = templates.find((item) => item.built_in === null) ?? templates[0];
  const chosen = source ?? fallback ?? null;
  const isDraft = chosen !== null && !("id" in chosen);
  const base: StudyTemplateSummary | null | undefined = isDraft
    ? templates.find((item) => item.id === chosen.from)
    : chosen;
  const own = !isDraft && base?.built_in === null;
  const startName = isDraft ? chosen.name : own ? (base?.name ?? "") : `${base?.name ?? ""} copy`;
  const [name, setName] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<EditorBlock[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [paper, setPaper] = useState<string>(isDraft ? chosen.paper : "a4");
  const [watermark, setWatermark] = useState(true);
  const [signature, setSignature] = useState(true);
  const [blind, setBlind] = useState(base?.presets.blinding ?? true);
  const [showPdf, setShowPdf] = useState(false);
  if (chosen === null) return null;
  const shownBlocks: EditorBlock[] =
    blocks ??
    (base && !(isDraft && chosen.from === null)
      ? base.blocks.map((block, index) => ({
          id: `${block.kind}-${index}`,
          kind: block.kind,
          title: block.title,
        }))
      : []);
  const shownName = name ?? startName;
  const current = shownBlocks.find((block) => block.id === selected) ?? null;
  const add = (kind: BlockKind) => {
    const block = { id: `${kind}-${Date.now()}`, kind, title: blockCopy[kind].name };
    const at = current ? shownBlocks.indexOf(current) + 1 : shownBlocks.length;
    setBlocks([...shownBlocks.slice(0, at), block, ...shownBlocks.slice(at)]);
    setSelected(block.id);
  };
  const move = (step: -1 | 1) => {
    if (current === null) return;
    const at = shownBlocks.indexOf(current);
    const to = at + step;
    if (to < 0 || to >= shownBlocks.length) return;
    const next = [...shownBlocks];
    next.splice(at, 1);
    next.splice(to, 0, current);
    setBlocks(next);
  };
  const remove = () => {
    if (current === null) return;
    setBlocks(shownBlocks.filter((block) => block !== current));
    setSelected(null);
  };
  const nextVersion = (base?.version ?? 0) + 1;
  const hint = own
    ? `Saving makes v${nextVersion}. A task keeps the version it was created with.`
    : isDraft
      ? "Saving adds it to the library as v1. Researchers can pick it in a new review task."
      : "Saving adds the copy to the library as v1.";
  const save = () => {
    const presets = base?.presets ?? { objects_to_check: { kind: "all-regions" as const } };
    const body = {
      name: shownName.trim() || "Untitled template",
      study_kind: isDraft ? chosen.kind : (base?.study_kind ?? "other"),
      blocks: shownBlocks.map(
        (block) =>
          (base?.blocks.find((item) => item.kind === block.kind) ?? {
            kind: block.kind,
            title: block.title,
          }) as StudyTemplateSummary["blocks"][number],
      ),
      presets: { ...presets, blinding: blind },
    };
    const done = () => {
      notify(
        own
          ? `Saved ${body.name} v${nextVersion}. Tasks made from the earlier version keep it.`
          : `Saved ${body.name} v1. Researchers can pick it in a new review task.`,
      );
      onBack();
    };
    if (own && base) {
      edit.mutate({ templateId: base.id, data: body }, { onSuccess: done });
    } else {
      create.mutate({ data: body }, { onSuccess: done });
    }
  };
  const pageBlocks: PageBlock[] = shownBlocks.map((block) => ({
    id: block.id,
    name: block.title,
    shows: blockCopy[block.kind].shows,
  }));
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)_300px]">
        <aside className="grid content-start gap-2 overflow-auto border-r border-line bg-chrome p-3.5">
          <b className="text-body-sm">Blocks</b>
          <p className="m-0 text-caption text-fg-dim">
            Drag one onto the page, or click it to add it after the selected block.
          </p>
          <BlockCatalogue
            aria-label="Block catalogue"
            blocks={(Object.keys(blockCopy) as BlockKind[]).map((kind) => ({
              id: kind,
              name: blockCopy[kind].name,
              shows: blockCopy[kind].shows,
            }))}
            onAdd={(id) => add(id as BlockKind)}
          />
        </aside>
        <div className="grid content-start justify-items-center gap-4 overflow-auto bg-canvas p-6">
          <ReportPagePreview
            title={shownName || "Untitled template"}
            blocks={pageBlocks}
            {...(current ? { selected: current.id } : {})}
            onBlockSelect={setSelected}
            className={cn(paper === "letter" && "aspect-[216/279]")}
          />
          {pageBlocks.length === 0 ? (
            <span className="text-body-sm text-fg-dim">
              An empty page. Click a block on the left to add it.
            </span>
          ) : null}
        </div>
        <aside className="overflow-auto border-l border-line bg-chrome p-3.5">
          <Tabs defaultValue={isDraft && chosen.from === null ? "block" : "format"}>
            <TabsList>
              <TabsTrigger value="block">Block</TabsTrigger>
              <TabsTrigger value="format">Page and format</TabsTrigger>
              <TabsTrigger value="presets">Task presets</TabsTrigger>
            </TabsList>
            <TabsContent value="block" className="grid gap-3 pt-3">
              {current ? (
                <>
                  <div className="flex gap-1.5">
                    <Button size="sm" onClick={() => move(-1)} aria-label="Move up">
                      Up
                    </Button>
                    <Button size="sm" onClick={() => move(1)} aria-label="Move down">
                      Down
                    </Button>
                    <Button size="sm" variant="destructive" onClick={remove}>
                      Remove
                    </Button>
                  </div>
                  <BlockSettings
                    key={current.id}
                    block={{
                      id: current.id,
                      name: current.title,
                      shows: blockCopy[current.kind].shows,
                    }}
                  />
                </>
              ) : (
                <span className="text-body-sm text-fg-dim">
                  Click a block on the page to set its title, width and fields.
                </span>
              )}
            </TabsContent>
            <TabsContent value="format" className="grid gap-3 pt-3">
              <FormField label="Name">
                <TextFieldInput
                  value={shownName}
                  onChange={(event) => setName(event.target.value)}
                />
              </FormField>
              <div className="grid gap-1.5">
                <span id="editor-paper" className="text-body-sm font-semibold">
                  Paper
                </span>
                <SegmentedControl
                  aria-labelledby="editor-paper"
                  value={paper}
                  onValueChange={(value) => setPaper(String(value))}
                  options={[
                    { value: "a4", label: "A4" },
                    { value: "letter", label: "US Letter" },
                  ]}
                />
              </div>
              <label className="flex items-center justify-between text-body-sm">
                Draft watermark
                <Switch checked={watermark} onCheckedChange={setWatermark} />
              </label>
              <label className="flex items-center justify-between text-body-sm">
                Signature block
                <Switch checked={signature} onCheckedChange={setSignature} />
              </label>
            </TabsContent>
            <TabsContent value="presets" className="grid gap-3 pt-3">
              <span className="text-body-sm text-fg-dim">
                {base
                  ? presetsText(base)
                  : "Tumor regions, blind, guided review, everyone reviews all"}
              </span>
              <label className="flex items-center justify-between text-body-sm">
                Blind review
                <Switch checked={blind} onCheckedChange={setBlind} />
              </label>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
      <div className="flex items-center gap-2.5 border-t border-line bg-chrome px-5 py-3">
        <Button onClick={onBack}>Back to the library</Button>
        <span className="flex-1 text-body-sm text-fg-dim">{hint}</span>
        <Button onClick={() => setShowPdf(true)}>
          <Icon name="eye" />
          Preview the PDF
        </Button>
        <Button variant="primary" onClick={save}>
          {own ? `Save as v${nextVersion}` : "Save template"}
        </Button>
      </div>
      <Dialog open={showPdf} onOpenChange={setShowPdf}>
        <DialogContent className="max-w-160">
          <DialogHeader>
            <DialogTitle>{shownName || "Untitled template"} · sample PDF</DialogTitle>
          </DialogHeader>
          <div className="grid place-items-center bg-canvas p-4">
            <ReportPagePreview title={shownName || "Untitled template"} blocks={pageBlocks} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const editorTitle = (
  source: StudyTemplateSummary | TemplateDraft | null,
  templates: StudyTemplateSummary[],
) => {
  const chosen = source ?? templates.find((item) => item.built_in === null) ?? templates[0];
  if (chosen === undefined) return { title: "Untitled template", sub: "" };
  if (!("id" in chosen)) {
    return { title: chosen.name, sub: `${kindLabel(chosen.kind)} · a new template` };
  }
  return chosen.built_in === null
    ? { title: chosen.name, sub: `${kindLabel(chosen.study_kind)} · editing v${chosen.version}` }
    : {
        title: `${chosen.name} copy`,
        sub: `${kindLabel(chosen.study_kind)} · a copy of ${chosen.name}, which comes with Parfocal`,
      };
};
