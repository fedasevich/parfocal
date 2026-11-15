import { Trans, useLingui } from "@lingui/react/macro";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Icon } from "@parfocal/ui/components/icon";
import { dragType, ReportPages } from "@parfocal/ui/components/report-editor-pages";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Switch } from "@parfocal/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@parfocal/ui/components/tabs";
import { Textarea } from "@parfocal/ui/components/textarea";
import {
  addBlock,
  appendixOptions,
  type BlockField,
  type BlockKind,
  blockCopy,
  blockFields,
  blockKinds,
  downloadOptions,
  type EditorBlock,
  type FieldOption,
  type FormatSettings,
  fieldValueText,
  insertionIndex,
  selectedValue,
  setBlockField,
  toggleIn,
} from "@parfocal/ui/lib/report-editor-model";
import { cn } from "@parfocal/ui/lib/utils";
import * as React from "react";

const noTaskValue = "none";
const fillFields = {
  task: "{task}",
  model: "{model}",
  version: "{version}",
  slides: "{slides}",
};

const inputClass =
  "min-h-8 w-full rounded-ctl border border-line-strong bg-surf-field px-2.5 text-body-sm text-fg outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]";

function FieldLabel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <span id={id} className="text-body-sm font-semibold">
      {children}
    </span>
  );
}

function BlockFieldControl({
  field,
  block,
  onChange,
}: {
  field: BlockField;
  block: EditorBlock;
  onChange: (value: unknown) => void;
}) {
  const labelId = `${block.id}-${field.key}`;
  if (field.kind === "toggle") {
    return (
      <div className="flex items-center justify-between gap-3 text-body-sm">
        <span id={labelId} className="font-semibold">
          {field.label}
        </span>
        <Switch
          aria-labelledby={labelId}
          checked={block[field.key] === true}
          onCheckedChange={(checked) => onChange(checked)}
        />
      </div>
    );
  }
  if (field.kind === "checks") {
    const current = Array.isArray(block[field.key]) ? (block[field.key] as string[]) : [];
    const order = field.options.map((option) => option.value);
    return (
      <div role="group" aria-labelledby={labelId} className="grid gap-1.5">
        <FieldLabel id={labelId}>{field.label}</FieldLabel>
        {field.options.map((option) => (
          <div key={option.value} className="flex items-center gap-2 text-body-sm">
            <Checkbox
              aria-label={option.label}
              checked={current.includes(option.value)}
              onCheckedChange={() =>
                onChange(toggleIn(current, option.value, order, field.keepOne))
              }
            />
            <span aria-hidden="true">{option.label}</span>
          </div>
        ))}
      </div>
    );
  }
  if (field.kind === "segment") {
    return (
      <div className="grid gap-1.5">
        <FieldLabel id={labelId}>{field.label}</FieldLabel>
        <SegmentedControl
          aria-labelledby={labelId}
          value={fieldValueText(field, block)}
          onValueChange={(value) => onChange(selectedValue(field, String(value)))}
          options={field.options}
        />
      </div>
    );
  }
  if (field.kind === "select") {
    const value = fieldValueText(field, block);
    return (
      <div className="grid gap-1.5">
        <FieldLabel id={labelId}>{field.label}</FieldLabel>
        <Select
          value={value}
          onValueChange={(next) => onChange(selectedValue(field, String(next)))}
        >
          <SelectTrigger aria-label={field.label} className="w-full">
            <SelectValue>
              {field.options.find((option) => option.value === value)?.label ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  return (
    <div className="grid gap-1.5">
      <FieldLabel id={labelId}>{field.label}</FieldLabel>
      <Textarea
        aria-labelledby={labelId}
        rows={field.rows}
        value={typeof block[field.key] === "string" ? (block[field.key] as string) : ""}
        onChange={(event) => onChange(event.target.value)}
      />
      {block.kind === "text" ? (
        <small className="text-caption text-fg-dim">
          <Trans>
            Fills in {fillFields.task}, {fillFields.model}, {fillFields.version} and{" "}
            {fillFields.slides} from the task.
          </Trans>
        </small>
      ) : null}
    </div>
  );
}

function BlockPanel({
  block,
  count,
  index,
  onChange,
  compareChoices,
}: {
  block: EditorBlock | null;
  count: number;
  index: number;
  onChange: (field: string, value: unknown) => void;
  compareChoices?: FieldOption[] | undefined;
}) {
  const { t } = useLingui();
  if (block === null) {
    return (
      <p className="m-0 text-body-sm text-fg-dim">
        <Trans>Click a block on the page to set its title, width and fields.</Trans>
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      <div className="grid gap-0.5 text-body-sm">
        <b>{blockCopy[block.kind].name}</b>
        <small className="text-caption text-fg-dim">
          <Trans>
            Block {index + 1} of {count}
          </Trans>
          . {blockCopy[block.kind].shows}.
        </small>
      </div>
      {block.kind === "comparison" && compareChoices ? (
        <BlockFieldControl
          field={{
            kind: "select",
            key: "task_id",
            label: t`Compare with task`,
            options: [{ value: noTaskValue, label: t`Pick a task` }, ...compareChoices],
            nullAs: noTaskValue,
          }}
          block={block}
          onChange={(value) => onChange("task_id", value)}
        />
      ) : null}
      {blockFields[block.kind].map((field) => (
        <BlockFieldControl
          key={`${block.id}-${field.key}`}
          field={field}
          block={block}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}
      <div className="grid gap-1.5">
        <label htmlFor={`${block.id}-title`} className="text-body-sm font-semibold">
          <Trans>Title</Trans>
        </label>
        <input
          id={`${block.id}-title`}
          className={inputClass}
          value={block.title}
          maxLength={120}
          onChange={(event) => onChange("title", event.target.value)}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-body-sm">
        <span id={`${block.id}-show-title`} className="font-semibold">
          <Trans>Show the title</Trans>
        </span>
        <Switch
          aria-labelledby={`${block.id}-show-title`}
          checked={block.show_title}
          onCheckedChange={(checked) => onChange("show_title", checked)}
        />
      </div>
      <div className="grid gap-1.5">
        <FieldLabel id={`${block.id}-width`}>
          <Trans>Width</Trans>
        </FieldLabel>
        <SegmentedControl
          aria-labelledby={`${block.id}-width`}
          value={block.width}
          onValueChange={(value) => onChange("width", String(value))}
          options={[
            { value: "full", label: t`Full width` },
            { value: "half", label: t`Half` },
          ]}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-body-sm">
        <span id={`${block.id}-page-break`} className="font-semibold">
          <Trans>Start on a new page</Trans>
        </span>
        <Switch
          aria-labelledby={`${block.id}-page-break`}
          checked={block.page_break}
          onCheckedChange={(checked) => onChange("page_break", checked)}
        />
      </div>
    </div>
  );
}

function FormatPanel({
  format,
  onChange,
  head,
}: {
  format: FormatSettings;
  onChange: (format: FormatSettings) => void;
  head?: React.ReactNode;
}) {
  const { t } = useLingui();

  const set = <K extends keyof FormatSettings>(key: K, value: FormatSettings[K]) =>
    onChange({ ...format, [key]: value });
  const segment = <K extends keyof FormatSettings>(
    key: K,
    label: string,
    options: { value: string; label: string }[],
  ) => (
    <div className="grid gap-1.5">
      <FieldLabel id={`format-${key}`}>{label}</FieldLabel>
      <SegmentedControl
        aria-labelledby={`format-${key}`}
        value={String(format[key])}
        onValueChange={(value) =>
          set(key, (key === "decimals" ? Number(value) : String(value)) as FormatSettings[K])
        }
        options={options}
      />
    </div>
  );
  const toggle = (
    key: "logo" | "running_header" | "draft_watermark" | "signature",
    label: string,
  ) => (
    <div className="flex items-center justify-between gap-3 text-body-sm">
      <span id={`format-${key}`} className="font-semibold">
        {label}
      </span>
      <Switch
        aria-labelledby={`format-${key}`}
        checked={format[key]}
        onCheckedChange={(checked) => set(key, checked)}
      />
    </div>
  );
  const text = (key: "title" | "subtitle", label: string, hint?: string) => (
    <div className="grid gap-1.5">
      <label htmlFor={`format-${key}`} className="text-body-sm font-semibold">
        {label}
      </label>
      <input
        id={`format-${key}`}
        className={inputClass}
        value={format[key]}
        maxLength={key === "title" ? 120 : 200}
        onChange={(event) => set(key, event.target.value)}
      />
      {hint ? <small className="text-caption text-fg-dim">{hint}</small> : null}
    </div>
  );
  const checks = <K extends "appendices" | "downloads">(
    key: K,
    label: string,
    options: { value: FormatSettings[K][number]; label: string }[],
    keepOne: boolean,
  ) => (
    <div role="group" aria-labelledby={`format-${key}`} className="grid gap-1.5">
      <FieldLabel id={`format-${key}`}>{label}</FieldLabel>
      {options.map((option) => (
        <div key={option.value} className="flex items-center gap-2 text-body-sm">
          <Checkbox
            aria-label={option.label}
            checked={(format[key] as string[]).includes(option.value)}
            onCheckedChange={() =>
              set(
                key,
                toggleIn(
                  format[key] as string[],
                  option.value,
                  options.map((item) => item.value),
                  keepOne,
                ) as FormatSettings[K],
              )
            }
          />
          <span aria-hidden="true">{option.label}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="grid gap-4">
      {head}
      {segment("paper", t`Paper`, [
        { value: "a4", label: "A4" },
        { value: "letter", label: "US Letter" },
      ])}
      {segment("orientation", t`Orientation`, [
        { value: "portrait", label: t`Portrait` },
        { value: "landscape", label: t`Landscape` },
      ])}
      {segment("text_size", t`Text size`, [
        { value: "small", label: t`Small` },
        { value: "normal", label: t`Normal` },
        { value: "large", label: t`Large` },
      ])}
      {toggle("logo", t`Workspace logo`)}
      {text("title", t`Title`)}
      {text(
        "subtitle",
        t`Subtitle`,
        t`Fills in ${fillFields.task}, ${fillFields.model}, ${fillFields.version} and ${fillFields.slides}.`,
      )}
      {toggle("running_header", t`Running header from page 2`)}
      <div className="grid gap-1.5">
        <FieldLabel id="format-page_numbers">
          <Trans>Page numbers</Trans>
        </FieldLabel>
        <Select
          value={format.page_numbers}
          onValueChange={(value) => set("page_numbers", value as FormatSettings["page_numbers"])}
        >
          <SelectTrigger aria-label={t`Page numbers`} className="w-full">
            <SelectValue>
              {{ "page-of": "Page 1 of 3", page: "1", none: "None" }[format.page_numbers]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="page-of">Page 1 of 3</SelectItem>
            <SelectItem value="page">1</SelectItem>
            <SelectItem value="none">None</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {toggle("draft_watermark", t`DRAFT watermark until signed off`)}
      {toggle("signature", t`Signature block`)}
      <div className="grid gap-1.5">
        <FieldLabel id="format-label_language">
          <Trans>Language of labels</Trans>
        </FieldLabel>
        <Select
          value={format.label_language}
          onValueChange={(value) =>
            set("label_language", value as FormatSettings["label_language"])
          }
        >
          <SelectTrigger aria-label={t`Language of labels`} className="w-full">
            <SelectValue>
              {{ en: "English", cs: "Czech", de: "German" }[format.label_language]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="cs">Czech</SelectItem>
            <SelectItem value="de">German</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {segment("decimals", t`Decimals`, [
        { value: "1", label: "0.9" },
        { value: "2", label: "0.86" },
        { value: "3", label: "0.861" },
      ])}
      {checks("appendices", t`Appendices after the report`, appendixOptions, false)}
      {checks("downloads", t`Downloads offered`, downloadOptions, true)}
    </div>
  );
}

type ReportEditorProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  name: string;
  blocks: EditorBlock[];
  onBlocksChange: (blocks: EditorBlock[]) => void;
  format: FormatSettings;
  onFormatChange: (format: FormatSettings) => void;
  formatHead?: React.ReactNode;
  presets?: React.ReactNode;
  initialSelected?: string | null;
  initialTab?: "block" | "format" | "presets";
  footer?: React.ReactNode;
  compareChoices?: FieldOption[] | undefined;
};

function ReportEditor({
  name,
  blocks,
  onBlocksChange,
  format,
  onFormatChange,
  formatHead,
  presets,
  initialSelected = null,
  initialTab = "block",
  footer,
  compareChoices,
  className,
  ...props
}: ReportEditorProps) {
  const { t } = useLingui();

  const [selected, setSelected] = React.useState<string | null>(initialSelected);
  const [tab, setTab] = React.useState<string>(initialTab);
  const current = blocks.find((block) => block.id === selected) ?? null;
  const select = (id: string | null) => {
    setSelected(id);
    if (id !== null) setTab("block");
  };
  const addAfterSelected = (kind: BlockKind) => {
    const result = addBlock(blocks, kind, insertionIndex(blocks, selected));
    onBlocksChange(result.blocks);
    select(result.added.id);
  };
  return (
    <div
      data-slot="report-editor"
      className={cn("grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]", className)}
      {...props}
    >
      <div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)_320px]">
        <aside
          aria-label={t`Block catalogue`}
          className="grid content-start gap-2 overflow-auto border-r border-line bg-chrome p-3.5"
        >
          <b className="text-body-sm">
            <Trans>Blocks</Trans>
          </b>
          <p className="m-0 text-caption text-fg-dim">
            <Trans>Drag one onto the page, or click it to add it after the selected block.</Trans>
          </p>
          <div className="grid gap-1.5">
            {blockKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(dragType, `new:${kind}`);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => addAfterSelected(kind)}
                className="grid cursor-grab grid-cols-[16px_minmax(0,1fr)] items-start gap-2.5 rounded-ctl border border-line bg-surf-field px-3 py-2 text-left text-body-sm text-fg hover:border-line-strong"
              >
                <Icon name="list" className="mt-0.5 text-fg-dim" />
                <span className="min-w-0">
                  <b className="block font-semibold">{blockCopy[kind].name}</b>
                  <small className="block text-caption text-fg-dim">{blockCopy[kind].shows}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <div
          role="region"
          aria-label={t`The report as pages`}
          className="overflow-auto bg-canvas p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) select(null);
          }}
        >
          <ReportPages
            title={name}
            blocks={blocks}
            format={format}
            selected={selected}
            onSelect={select}
            onBlocksChange={onBlocksChange}
            onSelectedChange={select}
          />
        </div>
        <aside className="overflow-auto border-l border-line bg-chrome p-3.5">
          <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
            <TabsList>
              <TabsTrigger value="block">
                <Trans>Block</Trans>
              </TabsTrigger>
              <TabsTrigger value="format">
                <Trans>Page and format</Trans>
              </TabsTrigger>
              {presets ? (
                <TabsTrigger value="presets">
                  <Trans>Task presets</Trans>
                </TabsTrigger>
              ) : null}
            </TabsList>
            <TabsContent value="block" className="pt-3">
              <BlockPanel
                block={current}
                compareChoices={compareChoices}
                count={blocks.length}
                index={blocks.findIndex((block) => block.id === selected)}
                onChange={(field, value) =>
                  current && onBlocksChange(setBlockField(blocks, current.id, field, value))
                }
              />
            </TabsContent>
            <TabsContent value="format" className="pt-3">
              <FormatPanel format={format} onChange={onFormatChange} head={formatHead} />
            </TabsContent>
            {presets ? (
              <TabsContent value="presets" className="grid gap-3 pt-3">
                {presets}
              </TabsContent>
            ) : null}
          </Tabs>
        </aside>
      </div>
      {footer}
    </div>
  );
}

export { FormatPanel, ReportEditor, type ReportEditorProps };
