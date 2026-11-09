import type { SlideResultStats } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { ObjectIdTag, StatusTag } from "@parfocal/ui/components/tag";
import { ClassCounts, ScoreHistogram } from "@parfocal/ui/components/visualize";
import { Zone } from "@parfocal/ui/components/zone";
import { useState } from "react";
import { type Count, countWord } from "../review/decision-style.ts";
import { columnTitle, type TableRowItem, tableColumns } from "./object-table-rows.ts";

const tone = { agree: "ok", disagree: "bad", unsure: "warn" } as const satisfies Record<
  Count,
  string
>;

type ObjectTablePanelProps = {
  slideLabel: string;
  pathOf: (object: string) => string;
  rows: TableRowItem[];
  stats: SlideResultStats | undefined;
  classColour: (name: string) => string;
  showScore: boolean;
  presetUsed: boolean;
  cutoff: number;
  selected: string | null;
  onPick: (object: string) => void;
  onCsv: () => void;
};

export function ObjectTablePanel({
  slideLabel,
  pathOf,
  rows,
  stats,
  classColour,
  showScore,
  presetUsed,
  cutoff,
  selected,
  onPick,
  onCsv,
}: ObjectTablePanelProps) {
  const [find, setFind] = useState("");
  const columns = tableColumns({ showScore, presetUsed });
  const shown = rows.filter((row) => row.object.toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <section
      aria-label={`Objects on ${slideLabel}`}
      className="flex h-75 shrink-0 flex-col border-t border-line bg-chrome"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <b className="text-body font-semibold" data-phi="">
          Objects on {slideLabel}
        </b>
        <span className="min-w-0 flex-1 truncate text-body-sm text-fg-dim">
          {stats ? `${stats.object_count.toLocaleString("en-US")} in all · ` : ""}showing the
          regions, your added region and the cells with a note or a disagreement
        </span>
        <Input
          className="h-8 w-52"
          value={find}
          onChange={(event) => setFind(event.target.value)}
          placeholder="Find an ID"
          aria-label="Find an ID"
        />
        <Button size="sm" onClick={onCsv}>
          <Icon name="download" />
          CSV
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 gap-4 px-4 pb-3">
        <div className="min-w-0 flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{columnTitle[column]}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <TableRow
                  key={row.object}
                  data-state={row.object === selected ? "selected" : undefined}
                  tabIndex={0}
                  className="cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid"
                  onClick={() => onPick(row.object)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onPick(row.object);
                    }
                  }}
                >
                  <TableCell>
                    <ObjectIdTag
                      copyText={pathOf(row.object)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {row.object}
                    </ObjectIdTag>
                  </TableCell>
                  <TableCell>{row.kind}</TableCell>
                  {showScore ? (
                    <TableCell className="font-mono">
                      {row.score === null ? "no score" : row.score.toFixed(2)}
                    </TableCell>
                  ) : null}
                  <TableCell className="font-mono">{row.size}</TableCell>
                  <TableCell>
                    {row.added ? (
                      <StatusTag tone="accent">Added</StatusTag>
                    ) : row.answer ? (
                      <StatusTag tone={tone[row.answer.value]}>
                        {countWord[row.answer.value]}
                      </StatusTag>
                    ) : (
                      <span className="text-fg-dim">open</span>
                    )}
                  </TableCell>
                  {presetUsed ? <TableCell className="text-fg-dim">{row.preset}</TableCell> : null}
                  <TableCell className="text-fg-dim">{row.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Zone
          title="Scores"
          end={<span className="text-caption text-fg-dim">Regions and cells</span>}
          className="w-80 shrink-0 overflow-auto"
        >
          <ScoreHistogram bins={stats?.score_bins ?? []} cutoff={cutoff} />
          <b className="text-body-sm font-semibold">Per class</b>
          <ClassCounts
            rows={(stats?.class_counts ?? []).map((row) => ({
              name: row.class_name,
              color: classColour(row.class_name),
              count: row.count,
            }))}
          />
        </Zone>
      </div>
    </section>
  );
}
