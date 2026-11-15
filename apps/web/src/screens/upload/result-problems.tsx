import {
  getGetImportProblemsQueryOptions,
  getGetUploadStatusQueryKey,
  type ImportProblem,
  type ProjectClass,
  ScoreDefault,
  useChooseHowToImport,
  useLeaveResultOut,
  useListProjectClasses,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Zone } from "@parfocal/ui/components/zone";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DoneRow, ProblemZone } from "./check-step.tsx";
import {
  notStored,
  openResultProblems,
  type ResultUpload,
  waitsForChoices,
} from "./result-problems-model.ts";
import { plural } from "./state.ts";

type Choices = {
  fixed: Record<string, boolean>;
  score: ScoreDefault;
  classId: string | null;
  mappings: Record<string, string>;
};

const noChoices: Choices = { fixed: {}, score: ScoreDefault.none, classId: null, mappings: {} };

const known = {
  unreadable: "objects-unreadable",
  noClass: "objects-without-class",
  unknownClasses: "unknown-classes",
  noScore: "scores-missing",
  outside: "partly-outside",
  scale: "heatmap-scale",
} as const;

function ClassSelect({
  classes,
  value,
  label,
  onChange,
}: {
  classes: readonly ProjectClass[];
  value: string | null;
  label: string;
  onChange: (id: string | null) => void;
}) {
  return (
    <Select value={value ?? ""} onValueChange={(next) => onChange(next === "" ? null : next)}>
      <SelectTrigger size="sm" aria-label={label} className="w-full max-w-64">
        <SelectValue placeholder="Choose a class" />
      </SelectTrigger>
      <SelectContent>
        {classes.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            <span className="inline-flex items-center gap-2">
              <span className="size-2.5 rounded-[3px]" style={{ background: item.colour }} />
              {item.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const fixedText = (problem: ImportProblem, choices: Choices, classes: readonly ProjectClass[]) => {
  const className = (id: string | null) => classes.find((item) => item.id === id)?.name ?? "";
  if (problem.code === known.noClass) return `Put in ${className(choices.classId)}`;
  if (problem.code === known.unknownClasses)
    return `${plural(problem.names.length, "class")} mapped`;
  if (problem.code === known.noScore)
    return choices.score === ScoreDefault.one ? "Counted as 1.0" : "Kept with no score";
  if (problem.code === known.outside) return "Left out of the import";
  if (problem.code === known.scale) return "Placed at the guessed level";
  return "Left out of the import";
};

const isFixed = (problem: ImportProblem, choices: Choices) => {
  if (problem.code === known.noClass) return choices.classId !== null;
  if (problem.code === known.unknownClasses)
    return problem.names.every((name) => choices.mappings[name] !== undefined);
  return choices.fixed[problem.code] === true;
};

const fixLabel: Record<string, string> = {
  [known.unreadable]: "Skip them",
  [known.noScore]: "Use this choice",
  [known.outside]: "Leave them out",
  [known.scale]: "Use this guess",
};

function ProblemFix({
  uploadId,
  name,
  problem,
  choices,
  classes,
  change,
}: {
  uploadId: string;
  name: string;
  problem: ImportProblem;
  choices: Choices;
  classes: readonly ProjectClass[];
  change: (next: Partial<Choices>) => void;
}) {
  if (isFixed(problem, choices)) {
    return (
      <DoneRow
        file={name}
        what={fixedText(problem, choices, classes)}
        onUndo={() => {
          const fixed = { ...choices.fixed };
          delete fixed[problem.code];
          change({
            fixed,
            ...(problem.code === known.noClass ? { classId: null } : {}),
            ...(problem.code === known.unknownClasses ? { mappings: {} } : {}),
          });
        }}
      />
    );
  }
  const confirm = () => change({ fixed: { ...choices.fixed, [problem.code]: true } });
  const guess = problem.guess;
  const evidence =
    problem.code === known.unknownClasses ? (
      <div className="grid gap-2 py-2.5">
        {problem.names.map((source) => (
          <div
            key={source}
            className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1.2fr)] items-center gap-2.5"
          >
            <b className="font-mono text-body-sm font-medium">{source}</b>
            <Icon name="next" className="text-fg-faint" />
            <ClassSelect
              classes={classes}
              value={choices.mappings[source] ?? null}
              label={`Class for ${source}`}
              onChange={(id) => {
                const mappings = { ...choices.mappings };
                if (id === null) delete mappings[source];
                else mappings[source] = id;
                change({ mappings });
              }}
            />
          </div>
        ))}
      </div>
    ) : problem.places.length > 0 ? (
      <div className="grid">
        {problem.places.slice(0, 5).map((place) => (
          <div
            key={place}
            className="border-line py-2 font-mono text-caption text-fg-dim [&+&]:border-t"
          >
            {place}
          </div>
        ))}
      </div>
    ) : undefined;
  const extra =
    problem.code === known.noClass ? (
      <ClassSelect
        classes={classes}
        value={choices.classId}
        label="Class for objects with none"
        onChange={(id) => change({ classId: id })}
      />
    ) : problem.code === known.noScore ? (
      <SegmentedControl
        aria-label="Objects with no score"
        value={choices.score}
        onValueChange={(value) => change({ score: value as ScoreDefault })}
        options={[
          { value: ScoreDefault.none, label: "Keep with no score" },
          { value: ScoreDefault.one, label: "Count as 1.0" },
        ]}
      />
    ) : problem.code === known.scale && guess !== null ? (
      <span className="text-body-sm text-fg-dim">
        Guess: level {guess.level ?? "unknown"}, scaled by {guess.downsample}
      </span>
    ) : null;
  const selectsOnly = problem.code === known.noClass || problem.code === known.unknownClasses;
  return (
    <ProblemZone
      icon={problem.code === known.unreadable ? "x-circle" : "warn"}
      tag={problem.count > 0 ? plural(problem.count, "object") : "To check"}
      tone={problem.code === known.unreadable ? "bad" : "warn"}
      title={problem.message}
      file={name}
      text={
        selectsOnly
          ? "Choose a class and the file imports with it."
          : "Confirm what to do and the file imports with your choice."
      }
      evidence={evidence}
      extra={extra}
      actions={
        <>
          {selectsOnly ? null : (
            <Button onClick={confirm}>{fixLabel[problem.code] ?? "Confirm"}</Button>
          )}
          {problem.code === known.unreadable ? (
            <Button
              nativeButton={false}
              render={<a href={`/api/uploads/${uploadId}/problems/report`} download />}
            >
              <Icon name="download" />
              Error report
            </Button>
          ) : null}
        </>
      }
    />
  );
}

function ResultChoices({ upload, projectId }: { upload: ResultUpload; projectId: string }) {
  const queryClient = useQueryClient();
  const [choices, setChoices] = useState<Choices>(noChoices);
  const found = useQuery(getGetImportProblemsQueryOptions(upload.uploadId));
  const classes = useListProjectClasses(projectId, { query: {} });
  const choose = useChooseHowToImport();
  const leave = useLeaveResultOut();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetUploadStatusQueryKey(upload.uploadId) });
  };
  const problems = found.data?.status === 200 ? found.data.data.problems : [];
  const list = classes.data?.status === 200 ? classes.data.data : [];
  const open = problems.filter((problem) => !isFixed(problem, choices));
  const change = (next: Partial<Choices>) => setChoices((current) => ({ ...current, ...next }));
  const send = () =>
    choose.mutate(
      {
        uploadId: upload.uploadId,
        data: {
          score_default: choices.score,
          unclassified_class_id: choices.classId,
          class_mappings: Object.entries(choices.mappings).map(([source_name, class_id]) => ({
            source_name,
            class_id,
          })),
        },
      },
      { onSuccess: refresh },
    );
  return (
    <>
      {problems.map((problem) => (
        <ProblemFix
          key={problem.code}
          uploadId={upload.uploadId}
          name={upload.name}
          problem={problem}
          choices={choices}
          classes={list}
          change={change}
        />
      ))}
      <Zone data-testid="result-choice-bar">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            data-testid="import-result"
            disabled={open.length > 0 || choose.isPending}
            onClick={send}
          >
            Import {upload.name}
          </Button>
          <Button
            variant="ghost"
            disabled={leave.isPending}
            onClick={() => leave.mutate({ uploadId: upload.uploadId }, { onSuccess: refresh })}
          >
            Leave it out
          </Button>
          {open.length > 0 ? (
            <span className="text-body-sm text-fg-dim">
              {plural(open.length, "problem")} left in this file
            </span>
          ) : null}
        </div>
      </Zone>
    </>
  );
}

export function ResultProblems({
  uploads,
  projectId,
}: {
  uploads: readonly ResultUpload[];
  projectId: string;
}) {
  const open = openResultProblems(uploads);
  const waiting = uploads.filter(waitsForChoices);
  const heatmaps = uploads.filter(notStored);
  if (uploads.length === 0) return null;
  return (
    <>
      <Zone
        title="Result files"
        sub={
          open > 0
            ? `${plural(open, "result file")} need${open === 1 ? "s" : ""} you. A file with a problem waits, the rest import.`
            : "Nothing needs you."
        }
        data-testid="result-problems-summary"
      />
      {waiting.map((upload) => (
        <ResultChoices key={upload.uploadId} upload={upload} projectId={projectId} />
      ))}
      {heatmaps.map((upload) => (
        <ProblemZone
          key={upload.uploadId}
          icon="layers"
          tag="Heatmap not kept"
          tone="warn"
          title="Parfocal cannot keep heatmaps yet"
          file={upload.name}
          text={
            upload.message ??
            "Parfocal checked this heatmap against its slide but cannot keep heatmaps yet."
          }
          actions={null}
        />
      ))}
    </>
  );
}
