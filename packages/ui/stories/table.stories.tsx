import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../src/components/button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TablePickCell,
  TablePickHead,
  TableRow,
  TableSortHead,
} from "../src/components/table.tsx";
import { StatusTag } from "../src/components/tag.tsx";
import {
  nextSort,
  pickStateOf,
  sortDirectionOf,
  sortRows,
  type TableSort,
  togglePick,
  togglePickAll,
} from "../src/lib/table-state.ts";

const meta = {
  title: "Components/Table",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

type SlideRow = {
  id: string;
  name: string;
  stain: string;
  objects: number;
  state: "Ready" | "In review" | "Done";
};

const slideRows: SlideRow[] = [
  { id: "S-0141", name: "Slide A1", stain: "H&E", objects: 1204, state: "Ready" },
  { id: "S-0142", name: "Slide A2", stain: "H&E", objects: 86, state: "In review" },
  { id: "S-0150", name: "Slide B1", stain: "Ki-67", objects: 3310, state: "Done" },
  { id: "S-0151", name: "Slide B2", stain: "HER2", objects: 452, state: "Ready" },
];

const stateTone = { Ready: "accent", "In review": "neutral", Done: "ok" } as const;

type SortKey = "id" | "name" | "objects";

function SlideTable({
  rows = slideRows,
  pickable = false,
  startSort = null,
  startPicked = [],
}: {
  rows?: SlideRow[];
  pickable?: boolean;
  startSort?: TableSort<SortKey> | null;
  startPicked?: string[];
}) {
  const [sort, setSort] = useState<TableSort<SortKey> | null>(startSort);
  const [picked, setPicked] = useState<Set<string>>(new Set(startPicked));
  const [opened, setOpened] = useState<string | null>(null);
  const shown = sortRows(rows, sort, (row, key) => row[key]);
  const ids = shown.map((row) => row.id);
  const sortBy = (key: SortKey) => setSort((current) => nextSort(current, key));
  const columns = pickable ? 6 : 5;
  return (
    <div className="w-[680px]">
      <Table aria-label="Slides in the project">
        <TableHeader>
          <TableRow>
            {pickable ? (
              <TablePickHead
                state={pickStateOf(picked, ids)}
                disabled={ids.length === 0}
                onToggle={() => setPicked((current) => togglePickAll(current, ids))}
              />
            ) : null}
            <TableSortHead direction={sortDirectionOf(sort, "id")} onSort={() => sortBy("id")}>
              ID
            </TableSortHead>
            <TableSortHead direction={sortDirectionOf(sort, "name")} onSort={() => sortBy("name")}>
              Slide
            </TableSortHead>
            <TableHead>Stain</TableHead>
            <TableSortHead
              numeric
              direction={sortDirectionOf(sort, "objects")}
              onSort={() => sortBy("objects")}
            >
              Objects
            </TableSortHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.length === 0 ? (
            <TableEmpty colSpan={columns} title="No slides in this project yet">
              Add slides from the project page, or change the filter to see slides you hid.
            </TableEmpty>
          ) : (
            shown.map((row) => (
              <TableRow key={row.id} selected={picked.has(row.id) || opened === row.id}>
                {pickable ? (
                  <TablePickCell
                    label={`Pick ${row.name}`}
                    picked={picked.has(row.id)}
                    onToggle={() => setPicked((current) => togglePick(current, row.id))}
                  />
                ) : null}
                <TableCell kind="id">{row.id}</TableCell>
                <TableCell>
                  <b>{row.name}</b>
                </TableCell>
                <TableCell>{row.stain}</TableCell>
                <TableCell kind="number">{row.objects.toLocaleString("en-US")}</TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center gap-2">
                    <StatusTag tone={stateTone[row.state]}>{row.state}</StatusTag>
                    <Button
                      size="xs"
                      aria-label={`Open ${row.name}`}
                      onClick={() => setOpened(row.id)}
                    >
                      Open
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <p className="mt-3 text-caption text-fg-dim" data-testid="table-status">
        {picked.size === 0 ? "No rows picked" : `${picked.size} picked`}
        {opened ? ` · opened ${opened}` : ""}
      </p>
    </div>
  );
}

export const Sorting: Story = {
  render: () => <SlideTable startSort={{ key: "objects", direction: "descending" }} />,
};

export const Selection: Story = {
  render: () => <SlideTable pickable startPicked={["S-0142"]} />,
};

export const Empty: Story = {
  render: () => <SlideTable pickable rows={[]} />,
};
