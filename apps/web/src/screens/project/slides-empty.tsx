import { Trans, useLingui } from "@lingui/react/macro";
import type { Project } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { TableEmpty } from "@parfocal/ui/components/table";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { fromFileList } from "../../upload/drop.ts";
import { dropStore } from "../../upload/drop-store.ts";
import type { NoMatch } from "./slide-filter-model.ts";

const columns = 4;

export function ProjectSlidesEmpty({ project }: { project: Project }) {
  const { t } = useLingui();

  const navigate = useNavigate();
  const picker = useRef<HTMLInputElement>(null);
  return (
    <TableEmpty
      colSpan={columns}
      data-testid="slides-empty"
      title={t`No slides in this project yet`}
      action={
        <span
          data-testid="slides-drop-area"
          className="flex w-full max-w-md flex-col items-center gap-3 rounded-zone border-[1.5px] border-dashed border-line-strong px-5 py-6"
        >
          <Icon name="upload" size="md" className="text-fg-dim" />
          <b className="text-body font-semibold text-fg">
            <Trans>Drop slides, results or a whole folder here</Trans>
          </b>
          <span className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => picker.current?.click()}>
              <Icon name="upload" />
              <Trans>Choose files</Trans>
            </Button>
            <Button
              nativeButton={false}
              render={
                <Link
                  to="/projects/$projectId/upload"
                  params={{ projectId: project.id }}
                  search={{ scene: "empty", flow: "live", source: "link" }}
                />
              }
            >
              <Icon name="link" />
              <Trans>Link a remote source</Trans>
            </Button>
          </span>
          <input
            ref={picker}
            type="file"
            multiple
            data-testid="slides-file-input"
            aria-label={t`Choose slides or result files`}
            className="sr-only"
            onChange={(event) => {
              const items = fromFileList(event.currentTarget.files);
              event.currentTarget.value = "";
              if (items.length === 0) return;
              dropStore.add(project.id, items);
              void navigate({
                to: "/projects/$projectId/upload",
                params: { projectId: project.id },
                search: { scene: "files", flow: "live" },
              });
            }}
          />
        </span>
      }
    >
      <Trans>Slides you upload show here, grouped by case. AI results are optional.</Trans>
    </TableEmpty>
  );
}

export function SlidesNoMatch({ match, onClear }: { match: NoMatch; onClear: () => void }) {
  const { t } = useLingui();

  const title = (() => {
    switch (match.kind) {
      case "needs-review":
        return t`No slides need review`;
      case "no-results":
        return t`Every slide has results`;
      case "result-set":
        return t`No slide has results from ${match.name}`;
      case "query":
        return t`No slide matches "${match.query}"`;
      case "several":
        return t`No slides match these filters`;
    }
  })();
  return (
    <TableEmpty
      colSpan={columns}
      data-testid="slides-no-match"
      title={title}
      action={
        <Button size="sm" onClick={onClear}>
          <Trans>Clear filters</Trans>
        </Button>
      }
    >
      <Trans>Take a filter off to see more slides.</Trans>
    </TableEmpty>
  );
}

export function CaseSlidesEmpty({ caseLabel }: { caseLabel: string }) {
  const { t } = useLingui();

  return (
    <TableEmpty
      colSpan={columns}
      data-testid="case-empty"
      title={t`No slides in case ${caseLabel} yet`}
      className="[&>td]:py-4"
    />
  );
}
