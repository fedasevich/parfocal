import {
  getListStudyTemplatesQueryKey,
  type Presets,
  type StudyTemplateSummary,
  useCreateStudyTemplate,
  useEditStudyTemplate,
  useListStudyTemplates,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { ReportEditor } from "@parfocal/ui/components/report-editor";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Switch } from "@parfocal/ui/components/switch";
import type { EditorBlock, FormatSettings } from "@parfocal/ui/lib/report-editor-model";
import { toApiBlocks } from "@parfocal/ui/lib/report-editor-model";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LazyTemplatePdf } from "../evaluation/pdf-overlay-lazy.tsx";
import { okData } from "../placeholder.tsx";
import { decisionSettings, toReviewStyle } from "../review/decision-style.ts";
import type { Notify } from "./common.tsx";
import { type DecisionPreset, DecisionPresetPicker } from "./decision-preset.tsx";
import {
  emptyPresets,
  formatOf,
  isDraft,
  nameProblem,
  problemTitle,
  type StudyKind,
  saveHint,
  scopeChoices,
  scopeFor,
  startingBlocks,
  studyKinds,
  type TemplateSource,
  templateBody,
} from "./template-model.ts";

const choice = (label: string, id: string) => (
  <span id={id} className="text-body-sm font-semibold">
    {label}
  </span>
);

function PresetsPanel({
  presets,
  decision,
  onPresets,
  onDecision,
}: {
  presets: Presets;
  decision: DecisionPreset;
  onPresets: (presets: Presets) => void;
  onDecision: (decision: DecisionPreset) => void;
}) {
  const scope = scopeChoices.find((item) => item.kind === presets.objects_to_check.kind);
  return (
    <div className="grid gap-4">
      <p className="m-0 text-caption text-fg-dim">
        A review task made from this template starts with these. The researcher can change each one
        in the task, and the report keeps the template.
      </p>
      <div className="grid gap-1.5">
        {choice("Objects to check", "preset-objects")}
        <Select
          value={presets.objects_to_check.kind}
          onValueChange={(value) =>
            onPresets({
              ...presets,
              objects_to_check: scopeFor(
                String(value) as Presets["objects_to_check"]["kind"],
                presets.objects_to_check,
              ),
            })
          }
        >
          <SelectTrigger aria-label="Objects to check" className="w-full">
            <SelectValue>{scope?.label ?? presets.objects_to_check.kind}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {scopeChoices.map((item) => (
              <SelectItem key={item.kind} value={item.kind}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DecisionPresetPicker value={decision} onChange={onDecision} />
      <div className="flex items-center justify-between gap-3 text-body-sm">
        {choice("Blind review", "preset-blind")}
        <Switch
          aria-labelledby="preset-blind"
          checked={presets.blinding ?? true}
          onCheckedChange={(checked) => onPresets({ ...presets, blinding: checked })}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-body-sm">
        {choice("First read without the AI", "preset-first")}
        <Switch
          aria-labelledby="preset-first"
          checked={presets.first_read ?? false}
          onCheckedChange={(checked) => onPresets({ ...presets, first_read: checked })}
        />
      </div>
      <div className="grid gap-1.5">
        {choice("Reviewers start in", "preset-start")}
        <SegmentedControl
          aria-labelledby="preset-start"
          value={presets.start_mode ?? "guided"}
          onValueChange={(value) =>
            onPresets({
              ...presets,
              start_mode: String(value) as NonNullable<Presets["start_mode"]>,
            })
          }
          options={[
            { value: "guided", label: "Guided review" },
            { value: "viewer", label: "Full viewer" },
          ]}
        />
      </div>
      <div className="grid gap-1.5">
        {choice("The work", "preset-split")}
        <SegmentedControl
          aria-labelledby="preset-split"
          value={presets.split ?? "everyone"}
          onValueChange={(value) =>
            onPresets({ ...presets, split: String(value) as NonNullable<Presets["split"]> })
          }
          options={[
            { value: "everyone", label: "Everyone all" },
            { value: "even", label: "Split" },
            { value: "chosen", label: "Per slide" },
          ]}
        />
      </div>
    </div>
  );
}

function EditorBody({
  source,
  library,
  notify,
  onBack,
}: {
  source: TemplateSource;
  library: StudyTemplateSummary[];
  notify: Notify;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const create = useCreateStudyTemplate();
  const edit = useEditStudyTemplate();
  const draft = isDraft(source);
  const base = draft ? library.find((item) => item.id === source.from) : source;
  const own = !draft && source.built_in === null;
  const [name, setName] = useState(draft ? source.name : own ? source.name : `${source.name} copy`);
  const [kind, setKind] = useState<StudyKind>(draft ? source.kind : source.study_kind);
  const [blocks, setBlocks] = useState<EditorBlock[]>(() => startingBlocks(source, library));
  const [format, setFormat] = useState<FormatSettings>(() =>
    formatOf(base, draft ? source.paper : undefined),
  );
  const [presets, setPresets] = useState<Presets>(base?.presets ?? emptyPresets);
  const baseStyle = toReviewStyle(base?.presets.decision);
  const [decision, setDecision] = useState<DecisionPreset>({
    style: baseStyle.kind,
    agreeFrom: baseStyle.agreeFrom,
    disagreeTo: baseStyle.disagreeTo,
  });
  const [showPdf, setShowPdf] = useState(false);
  const [tried, setTried] = useState(false);
  const problem = nameProblem(name, library, own ? source.name : undefined);
  const body = () =>
    templateBody({
      name,
      kind,
      blocks,
      format,
      presets: { ...presets, decision: decisionSettings(decision.style, decision) },
    });
  const version = own ? source.version + 1 : 1;
  const save = () => {
    setTried(true);
    if (problem) {
      notify(problem);
      return;
    }
    const saved = (response: { status: number; data: unknown }) => {
      if (response.status >= 300) {
        notify(problemTitle(response.data));
        return;
      }
      void queryClient.invalidateQueries({ queryKey: getListStudyTemplatesQueryKey() });
      notify(
        own
          ? `Saved ${name.trim()} v${version}. Tasks made from the earlier version keep it.`
          : `Saved ${name.trim()} v1. Researchers can pick it in a new review task.`,
      );
      onBack();
    };
    if (own) edit.mutate({ templateId: source.id, data: body() }, { onSuccess: saved });
    else create.mutate({ data: body() }, { onSuccess: saved });
  };
  return (
    <ReportEditor
      name={name}
      blocks={blocks}
      onBlocksChange={setBlocks}
      format={format}
      onFormatChange={setFormat}
      formatHead={
        <>
          <FormField label="Name" error={tried ? problem : undefined}>
            <TextFieldInput
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <div className="grid gap-1.5">
            {choice("Kind of study", "template-kind")}
            <Select value={kind} onValueChange={(value) => setKind(String(value) as StudyKind)}>
              <SelectTrigger aria-label="Kind of study" className="w-full">
                <SelectValue>
                  {studyKinds.find((item) => item.value === kind)?.label ?? kind}
                </SelectValue>
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
        </>
      }
      presets={
        <PresetsPanel
          presets={presets}
          decision={decision}
          onPresets={setPresets}
          onDecision={setDecision}
        />
      }
      footer={
        <div className="flex items-center gap-2.5 border-t border-line bg-chrome px-5 py-3">
          <Button onClick={onBack}>Back to the library</Button>
          <span className="flex-1 text-body-sm text-fg-dim">{saveHint(source)}</span>
          <Button onClick={() => setShowPdf(true)}>
            <Icon name="eye" />
            Preview the PDF
          </Button>
          <Button variant="primary" onClick={save} disabled={create.isPending || edit.isPending}>
            {own ? `Save as v${version}` : "Save template"}
          </Button>
          {showPdf ? (
            <LazyTemplatePdf
              draft={{
                name: name.trim() || "Untitled template",
                blocks: toApiBlocks(blocks) as unknown as StudyTemplateSummary["blocks"],
                format,
              }}
              onClose={() => setShowPdf(false)}
            />
          ) : null}
        </div>
      }
    />
  );
}

export function TemplateEditor({
  source,
  notify,
  onBack,
}: {
  source: TemplateSource | null;
  notify: Notify;
  onBack: () => void;
}) {
  const library = okData(useListStudyTemplates().data) ?? [];
  const chosen = source ?? library.find((item) => item.built_in === null) ?? library[0];
  if (chosen === undefined) return null;
  return (
    <EditorBody
      key={isDraft(chosen) ? `new-${chosen.name}` : chosen.id}
      source={chosen}
      library={library}
      notify={notify}
      onBack={onBack}
    />
  );
}
