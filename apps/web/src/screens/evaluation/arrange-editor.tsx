import {
  type EvaluationReport,
  getGetTaskReportLayoutQueryKey,
  getListStudyTemplatesQueryKey,
  type StudyTemplateSummary,
  type TaskReportLayoutDraft,
  useCreateStudyTemplate,
  useGetTaskReportLayout,
  useListStudyTemplates,
  useSetTaskReportLayout,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { ReportEditor } from "@parfocal/ui/components/report-editor";
import {
  defaultFormat,
  type EditorBlock,
  type FormatSettings,
  toApiBlocks,
  toEditorBlocks,
} from "@parfocal/ui/lib/report-editor-model";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { emptyPresets, formatOf, problemTitle, templateBody } from "../admin/template-model.ts";
import { okData } from "../placeholder.tsx";

type Saved = { blocks: Record<string, unknown>[]; format: FormatSettings };

export function ArrangeEditor({
  taskId,
  report,
  notify,
  onSaved,
  onBack,
}: {
  taskId: string;
  report: EvaluationReport;
  notify: (message: string) => void;
  onSaved: (saved: Saved) => void;
  onBack: () => void;
}) {
  const layout = okData(useGetTaskReportLayout(taskId).data);
  if (!layout) return null;
  return (
    <ArrangeBody
      key={taskId}
      taskId={taskId}
      report={report}
      start={{
        blocks: toEditorBlocks(layout.blocks),
        format: formatOf({ format: layout.format } as StudyTemplateSummary),
      }}
      notify={notify}
      onSaved={onSaved}
      onBack={onBack}
    />
  );
}

function ArrangeBody({
  taskId,
  report,
  start,
  notify,
  onSaved,
  onBack,
}: {
  taskId: string;
  report: EvaluationReport;
  start: { blocks: EditorBlock[]; format: FormatSettings };
  notify: (message: string) => void;
  onSaved: (saved: Saved) => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const library = okData(useListStudyTemplates().data) ?? [];
  const base = library.find((item) => item.id === report.template.id);
  const [blocks, setBlocks] = useState<EditorBlock[]>(start.blocks);
  const [format, setFormat] = useState<FormatSettings>(start.format);
  const [name, setName] = useState(`${report.template.name} for ${report.task_code}`);
  const save = useSetTaskReportLayout();
  const create = useCreateStudyTemplate();
  const saveForTask = () =>
    save.mutate(
      {
        taskId,
        data: {
          blocks: toApiBlocks(blocks) as unknown as TaskReportLayoutDraft["blocks"],
          format,
        },
      },
      {
        onSuccess: (response) => {
          if (response.status >= 300) {
            notify(problemTitle(response.data));
            return;
          }
          void queryClient.invalidateQueries({ queryKey: getGetTaskReportLayoutQueryKey(taskId) });
          notify("Arranged for this task. The template itself has not changed.");
          onSaved({ blocks: toApiBlocks(blocks), format });
        },
      },
    );
  const saveAsTemplate = () =>
    create.mutate(
      {
        data: templateBody({
          name,
          kind: base?.study_kind ?? "other",
          blocks,
          format,
          presets: base?.presets ?? emptyPresets,
        }),
      },
      {
        onSuccess: (response) => {
          if (response.status >= 300) {
            notify(problemTitle(response.data));
            return;
          }
          void queryClient.invalidateQueries({ queryKey: getListStudyTemplatesQueryKey() });
          notify(`Offered to the library as ${name.trim() || "Untitled template"}`);
        },
      },
    );
  const reset = () => {
    setBlocks(toEditorBlocks(report.template.blocks));
    setFormat({ ...defaultFormat, ...(report.template.format as Partial<FormatSettings>) });
  };
  return (
    <ReportEditor
      name={`${report.task_code} evaluation report`}
      blocks={blocks}
      onBlocksChange={setBlocks}
      format={format}
      onFormatChange={setFormat}
      formatHead={
        <FormField label="Name if saved as a template">
          <TextFieldInput
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
      }
      footer={
        <div className="flex items-center gap-2.5 border-t border-line bg-chrome px-5 py-3">
          <Button onClick={onBack}>Back to the report</Button>
          <span className="flex-1 text-body-sm text-fg-dim">
            Changes belong to this task. The template itself stays as it is.
          </span>
          <Button variant="ghost" onClick={reset}>
            Reset to the template
          </Button>
          <Button onClick={saveAsTemplate} disabled={create.isPending || name.trim() === ""}>
            Save as template
          </Button>
          <Button variant="primary" onClick={saveForTask} disabled={save.isPending}>
            Save for this task
          </Button>
        </div>
      }
    />
  );
}
