import { type SourceFile, useImportFromLink, useListSourceFiles } from "@parfocal/api-client";
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
  if (file.in_project) return `${file.detail} · already in ${projectCode}`;
  if (file.message) return `${file.detail} · ${file.message}`;
  return file.case ? `${file.detail} · case ${file.case.label}` : file.detail;
}

function importable(file: SourceFile) {
  return !file.in_project && file.refused === null;
}

export function LinkImport({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const [draft, setDraft] = useState("");
  const [address, setAddress] = useState("");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const query = useListSourceFiles(projectId, { address }, { query: { enabled: address !== "" } });
  const starting = useImportFromLink();
  const listing = okData(query.data);
  const refusal =
    query.data !== undefined && query.data.status !== 200
      ? problemText(query.data.data, "Parfocal could not read this link.")
      : null;
  const files = listing?.files ?? [];
  const chosen = files.filter((file) => importable(file) && !skipped.has(file.name));
  const started = starting.data?.status === 202 ? starting.data.data : undefined;
  const startError =
    starting.data !== undefined && starting.data.status !== 202
      ? problemText(starting.data.data, "The import could not start.")
      : null;
  const toggle = (name: string, on: boolean) => {
    const next = new Set(skipped);
    if (on) next.delete(name);
    else next.add(name);
    setSkipped(next);
  };
  return (
    <div data-testid="link-import" className="grid gap-(--space-zone)">
      <Zone title="Where are the files?" end={<Hint>An HTTPS, S3 or Azure link</Hint>}>
        <form
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            starting.reset();
            setSkipped(new Set());
            setAddress(draft.trim());
          }}
        >
          <Input
            aria-label="Address"
            value={draft}
            placeholder="https://data.example.org/slides/"
            onChange={(event) => setDraft(event.target.value)}
            className="font-mono"
          />
          <Button
            type="submit"
            variant={listing ? "secondary" : "primary"}
            disabled={!draft.trim()}
          >
            {listing ? "Check again" : "Check"}
          </Button>
        </form>
        <Hint>
          The Parfocal server fetches the files, not this computer, so a 20 GB slide never crosses
          your connection and closing the tab stops nothing.
        </Hint>
        {refusal ? (
          <div role="alert" className="text-body-sm text-danger">
            {refusal}
          </div>
        ) : null}
      </Zone>
      {listing ? (
        <Zone
          title="Found there"
          end={
            <Hint>
              {chosen.length} of {plural(files.length, "slide")}
            </Hint>
          }
        >
          {files.length === 0 ? (
            <div className="text-body-sm text-fg-dim">No slides at this link.</div>
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
                        aria-label={`Include ${file.name}`}
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
                  data: { address, names: chosen.map((file) => file.name) },
                })
              }
            >
              Import {plural(chosen.length, "slide")}
            </Button>
            {started ? (
              <span role="status" className="text-body-sm text-fg-dim">
                The server is fetching {plural(started.started.length, "file")}. They are checked
                and published like any upload.
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
