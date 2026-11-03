import type { DensityMode } from "@parfocal/tokens";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../src/components/button.tsx";
import { InspectorCard } from "../src/components/inspector.tsx";
import { SidePanel } from "../src/components/side-panel.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../src/components/table.tsx";

const slides = [
  ["Slide A1", "Lymph node", "Ready", "12"],
  ["Slide A2", "Lymph node", "In review", "8"],
  ["Slide B1", "Breast core", "Ready", "31"],
  ["Slide B2", "Breast core", "Waiting", "0"],
  ["Slide C1", "Colon", "Done", "4"],
  ["Slide C2", "Colon", "Ready", "17"],
];

function DensityDemo({ density }: { density: DensityMode }) {
  return (
    <div data-density={density} className="flex h-[560px] gap-6 bg-page p-4 text-fg">
      <div className="w-[460px]">
        <Table data-testid="list">
          <TableHeader>
            <TableRow>
              <TableHead>Slide</TableHead>
              <TableHead>Tissue</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Objects</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slides.map(([name, tissue, state, objects]) => (
              <TableRow key={name}>
                <TableCell>
                  <b>{name}</b>
                </TableCell>
                <TableCell>{tissue}</TableCell>
                <TableCell>{state}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{objects}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <SidePanel
        data-testid="inspector"
        tabs={[
          {
            value: "objects",
            label: "Objects",
            body: (
              <>
                <InspectorCard>Tumor area T1, 7.7 mm</InspectorCard>
                <InspectorCard>Tumor area T2, 1.3 mm</InspectorCard>
                <InspectorCard>Tumor area T3, 0.15 mm</InspectorCard>
              </>
            ),
            foot: <Button>Submit slide</Button>,
          },
          { value: "display", label: "Display", body: <p>Layers</p> },
        ]}
      />
    </div>
  );
}

const meta = {
  title: "Components/Density",
  component: DensityDemo,
} satisfies Meta<typeof DensityDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Comfortable: Story = { args: { density: "comfortable" } };

export const Compact: Story = { args: { density: "compact" } };
