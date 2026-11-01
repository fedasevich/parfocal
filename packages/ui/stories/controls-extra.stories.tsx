import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "../src/components/badge.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../src/components/card.tsx";
import { Checkbox } from "../src/components/checkbox.tsx";
import { Kbd } from "../src/components/kbd.tsx";
import { Label } from "../src/components/label.tsx";
import { RadioGroup, RadioGroupItem } from "../src/components/radio-group.tsx";
import { ScrollArea } from "../src/components/scroll-area.tsx";
import { Separator } from "../src/components/separator.tsx";
import { Skeleton } from "../src/components/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../src/components/table.tsx";
import { ObjectIdTag, StatusTag } from "../src/components/tag.tsx";

const meta = {
  title: "Controls/More controls",
  decorators: [
    (Story) => (
      <div className="rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Checkboxes: Story = {
  render: () => (
    <div className="grid gap-3 text-body-sm">
      <Label>
        <Checkbox defaultChecked />
        Include cells in the sample
      </Label>
      <Label>
        <Checkbox />
        Blind the reviewers
      </Label>
      <Label>
        <Checkbox disabled />
        First read without the AI
      </Label>
    </div>
  ),
};

export const RadioRows: Story = {
  render: () => (
    <RadioGroup defaultValue="all" aria-label="Split" className="grid w-96 gap-2.5">
      {[
        ["all", "Everyone reviews every slide", "Best for agreement between reviewers"],
        ["even", "Split evenly", "About 4 slides each"],
        ["per", "Per slide", "Pick who reviews each slide"],
      ].map(([value, title, sentence]) => (
        <Label key={value} className="items-start gap-2.5">
          <RadioGroupItem value={value ?? ""} className="mt-0.5" />
          <span className="grid gap-0.5">
            <b className="text-body-sm font-medium">{title}</b>
            <small className="text-body-sm font-normal text-fg-dim">{sentence}</small>
          </span>
        </Label>
      ))}
    </RadioGroup>
  ),
};

const rows = [
  { id: "T1", slide: "A1 · H&E", kind: "Tumor region", size: "6.2 mm", state: "agree" },
  { id: "T2", slide: "A1 · H&E", kind: "Tumor region", size: "3.1 mm", state: "disagree" },
  { id: "T1·C145", slide: "A1 · H&E", kind: "Tumor cell", size: "12 µm", state: "unsure" },
];

const tones = { agree: "ok", disagree: "bad", unsure: "warn" } as const;

export const TableRows: Story = {
  render: () => (
    <div className="w-[640px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Checkbox aria-label="Pick every row" />
            </TableHead>
            <TableHead>Object</TableHead>
            <TableHead>Slide</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead className="text-right" aria-sort="descending">
              Size
            </TableHead>
            <TableHead>Decision</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.id} data-state={index === 0 ? "selected" : undefined}>
              <TableCell>
                <Checkbox aria-label={`Pick ${row.id}`} defaultChecked={index === 0} />
              </TableCell>
              <TableCell>
                <ObjectIdTag>{row.id}</ObjectIdTag>
              </TableCell>
              <TableCell>
                <b>{row.slide}</b>
              </TableCell>
              <TableCell>{row.kind}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{row.size}</TableCell>
              <TableCell>
                <StatusTag tone={tones[row.state as keyof typeof tones]}>{row.state}</StatusTag>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};

export const TableEmpty: Story = {
  render: () => (
    <div className="w-[640px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Object</TableHead>
            <TableHead>Slide</TableHead>
            <TableHead>Decision</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell colSpan={3} className="text-center">
              Nothing in the queue. It opens when every reviewer has submitted.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  ),
};

export const Cards: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Sentinel node AI evaluation</CardTitle>
        <CardDescription>RT-14 · due 24 Oct</CardDescription>
      </CardHeader>
      <CardContent className="text-fg-dim">12 slides, 3 reviewers.</CardContent>
    </Card>
  ),
};

export const Misc: Story = {
  render: () => (
    <div className="grid w-80 gap-4 text-body-sm">
      <div className="flex items-center gap-2">
        <Badge>Badge</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Kbd>⌘K</Kbd>
      </div>
      <Separator />
      <div className="grid gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <ScrollArea className="h-24 rounded-ctl border border-line p-2">
        {Array.from({ length: 12 }, (_, index) => `Slide A${index + 1}`).map((name) => (
          <div key={name} className="py-1">
            {name}
          </div>
        ))}
      </ScrollArea>
    </div>
  ),
};
