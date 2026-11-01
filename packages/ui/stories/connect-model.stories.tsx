import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  ClassMapTable,
  CodeBlock,
  CodeKey,
  KeyValueList,
  SampleTilePreview,
} from "../src/components/connect-model.tsx";
import { mockAssets, projectClasses } from "./fixtures.ts";

const meta = {
  title: "Components/Connect a model",
  decorators: [
    (Story) => (
      <div className="w-180 rounded-zone bg-surf-panel p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const regions = [
  [
    [16, 22],
    [128, 14],
    [136, 84],
    [118, 128],
    [26, 132],
  ],
  [
    [20, 136],
    [112, 138],
    [104, 184],
    [18, 182],
  ],
] as const;

const cells = [
  { x: 34, y: 44, rx: 9, ry: 7, colour: "var(--c-tumor)" },
  { x: 62, y: 30, rx: 10, ry: 8, colour: "var(--c-tumor)" },
  { x: 118, y: 34, rx: 7, ry: 6, colour: "var(--c-immune)" },
  { x: 146, y: 52, rx: 6, ry: 6, colour: "var(--c-immune)" },
  { x: 196, y: 128, rx: 12, ry: 6, colour: "var(--c-stroma)" },
  { x: 234, y: 112, rx: 11, ry: 5, colour: "var(--c-stroma)" },
];

export const TilePreviews: Story = {
  render: () => (
    <div className="grid gap-4">
      <SampleTilePreview
        state="empty"
        image={mockAssets.hpf}
        label="Sample tile, not tested yet"
        emptyText="The outlines your server sends back show here, on the sample tile"
      />
      <SampleTilePreview
        state="ok"
        image={mockAssets.hpf}
        label="Sample tile with the server's outlines"
        regions={regions}
        cells={cells}
        time="412 ms"
      />
      <SampleTilePreview
        state="fail"
        image={mockAssets.hpf}
        label="Sample tile, the answer did not follow the contract"
        time="380 ms"
      />
    </div>
  ),
};

export const Contract: Story = {
  render: () => (
    <CodeBlock>
      {"POST https://ml.cuailab.cz/parfocal/infer\n"}
      <CodeKey>Authorization</CodeKey>
      {": Bearer $TOKEN\n{ "}
      <CodeKey>"size"</CodeKey>
      {": 512, "}
      <CodeKey>"magnification"</CodeKey>
      {": 40 }"}
    </CodeBlock>
  ),
};

export const Summary: Story = {
  render: () => (
    <KeyValueList
      tight
      rows={[
        { icon: "database", label: "Server", value: "ml.cuailab.cz" },
        { icon: "key", label: "Sign-in", value: "Token" },
        { icon: "target", label: "Returns", value: "Regions and cells" },
        { icon: "layers", label: "Tiles", value: "512 px at 40×, 4 at a time" },
        { icon: "users", label: "Runs it", value: "Every researcher" },
      ]}
    />
  ),
};

function ClassMapDemo() {
  const [map, setMap] = useState<Record<string, string | null>>({
    neoplastic: "Tumor",
    inflammatory: "Immune",
    connective: "Stroma",
    dead: null,
  });
  const counts: Record<string, number> = {
    neoplastic: 21,
    inflammatory: 9,
    connective: 5,
    dead: 1,
  };
  return (
    <ClassMapTable
      rows={Object.entries(map).map(([sent, value]) => ({
        sent,
        value,
        count: `${counts[sent] ?? 0} ${counts[sent] === 1 ? "cell" : "cells"}`,
      }))}
      options={[
        ...projectClasses.map((item) => ({
          value: item.name,
          label: item.name,
          colour: item.color,
        })),
        { value: "out", label: "Leave out of results" },
      ]}
      onValueChange={(sent, value) => setMap((current) => ({ ...current, [sent]: value }))}
    />
  );
}

export const ClassMap: Story = { render: () => <ClassMapDemo /> };
