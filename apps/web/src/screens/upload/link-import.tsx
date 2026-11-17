import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  type ImportSource,
  type SourceFile,
  useImportFromLink,
  useListImportSources,
  useListSourceFiles,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Input } from "@parfocal/ui/components/input";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { useState } from "react";
import { okData } from "../placeholder.tsx";
import { FileList, FileRow, Thumb } from "./parts.tsx";
import { plural } from "./state.ts";

type Problem = { detail?: string | null; title?: string };

function problemText(data: unknown, fallback: string) {
  const problem = data as Problem | undefined;
  return problem?.detail ?? problem?.title ?? fallback;
}

function detailOf(file: SourceFile, projectCode: string) {
  if (file.in_project) return t`${file.detail} · already in ${projectCode}`;
  if (file.message) return `${file.detail} · ${file.message}`;
  return file.case ? t`${file.detail} · case ${file.case.label}` : file.detail;
}

function importable(file: SourceFile) {
  return !file.in_project && file.refused === null;
}

function SavedSources({
  sources,
  chosen,
  onChoose,
}: {
  sources: ImportSource[];
  chosen: string | null;
  onChoose: (source: ImportSource) => void;
}) {
  const { t } = useLingui();
  if (sources.length === 0) return null;
  return (
    <fieldset
      aria-label={t`Saved sources`}
      className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
    >
      <span className="text-body-sm text-fg-dim">
        <Trans>Saved sources</Trans>
      </span>
      {sources.map((source) => (
        <Button
          key={source.id}
          size="sm"
          variant={chosen === source.id ? "selected" : "secondary"}
          aria-pressed={chosen === source.id}
          title={source.host}
          onClick={() => onChoose(source)}
        >
          {source.name}
        </Button>
      ))}
    </fieldset>
  );
}

export function LinkImport({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const { t } = useLingui();

  const [draft, setDraft] = useState("");
  const [address, setAddress] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const saved = okData(useListImportSources().data)?.sources ?? [];
  const where = sourceId ? { source_id: sourceId } : { address };
  const query = useListSourceFiles(projectId, where, {
    query: { enabled: sourceId !== null || address !== "" },
  });
  const starting = useImportFromLink();
  const restart = () => {
    starting.reset();
    setSkipped(new Set());
  };
  const listing = okData(query.data);
  const refusal =
    query.data !== undefined && query.data.status !== 200
      ? problemText(query.data.data, t`Parfocal could not read this link.`)
      : null;
  const files = listing?.files ?? [];
  const chosen = files.filter((file) => importable(file) && !skipped.has(file.name));
  const started = starting.data?.status === 202 ? starting.data.data : undefined;
  const startError =
    starting.data !== undefined && starting.data.status !== 202
      ? problemText(starting.data.data, t`The import could not start.`)
      : null;
  const toggle = (name: string, on: boolean) => {
    const next = new Set(skipped);
    if (on) next.delete(name);
    else next.add(name);
    setSkipped(next);
  };
  return (
    <div data-testid="link-import" className="grid gap-(--space-zone)">
      <Zone
        title={t`Where are the files?`}
        end={
          <Hint>
            <Trans>An HTTPS, S3 or Azure link</Trans>
          </Hint>
        }
      >
        <SavedSources
          sources={saved}
          chosen={sourceId}
          onChoose={(source) => {
            restart();
            setSourceId(source.id);
            setDraft("");
            setAddress("");
          }}
        />
        <form
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            restart();
            setSourceId(null);
            setAddress(draft.trim());
          }}
        >
          <Input
            aria-label={t`Address`}
            value={draft}
            placeholder={t`https://data.example.org/slides/`}
            onChange={(event) => setDraft(event.target.value)}
            className="font-mono"
          />
          <Button
            type="submit"
            variant={listing && sourceId === null ? "secondary" : "primary"}
            disabled={!draft.trim()}
          >
            {listing && sourceId === null ? t`Check again` : t`Check`}
          </Button>
        </form>
        <Hint>
          <Trans>
            The Parfocal server fetches the files, not this computer, so a 20 GB slide never crosses
            your connection and closing the tab stops nothing.
          </Trans>
        </Hint>
        {refusal ? (
          <div role="alert" className="text-body-sm text-danger">
            {refusal}
          </div>
        ) : null}
      </Zone>
      {listing ? (
        <Zone
          title={t`Found there`}
          end={
            <Hint>
              <Trans>
                {chosen.length} of {plural(files.length, "slide")}
              </Trans>
            </Hint>
          }
        >
          {files.length === 0 ? (
            <div className="text-body-sm text-fg-dim">
              <Trans>No slides at this link.</Trans>
            </div>
          ) : (
            <FileList>
              {files.map((file) => (
                <FileRow
                  key={file.name}
                  lead={
                    <span className="inline-flex items-center gap-3">
                      <Checkbox
                        checked={importable(file) && !skipped.has(file.name)}
                        disabled={!importable(file)}
                        onCheckedChange={(on) => toggle(file.name, on === true)}
                        aria-label={t`Include ${file.name}`}
                      />
                      <Thumb />
                    </span>
                  }
                  name={file.name}
                  detail={detailOf(file, projectCode)}
                />
              ))}
            </FileList>
          )}
          <div className="flex items-center gap-3">
            <Button
              disabled={chosen.length === 0 || starting.isPending || started !== undefined}
              onClick={() =>
                starting.mutate({
                  projectId,
                  data: { ...where, names: chosen.map((file) => file.name) },
                })
              }
            >
              <Trans>Import {plural(chosen.length, "slide")}</Trans>
            </Button>
            {started ? (
              <span role="status" className="text-body-sm text-fg-dim">
                <Trans>
                  The server is fetching {plural(started.started.length, "file")}. They are checked
                  and published like any upload.
                </Trans>
              </span>
            ) : null}
            {startError ? (
              <span role="alert" className="text-body-sm text-danger">
                {startError}
              </span>
            ) : null}
          </div>
        </Zone>
      ) : null}
    </div>
  );
}
