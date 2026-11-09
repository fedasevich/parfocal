import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ReportEditor } from "../src/components/report-editor.tsx";
import {
  createBlock,
  defaultFormat,
  type EditorBlock,
  type FormatSettings,
  toApiBlocks,
} from "../src/lib/report-editor-model.ts";

const meta = {
  title: "Components/Report editor",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function Harness({ start }: { start: EditorBlock[] }) {
  const [blocks, setBlocks] = useState(start);
  const [format, setFormat] = useState<FormatSettings>(defaultFormat);
  return (
    <div className="grid h-[820px] grid-rows-[minmax(0,1fr)_auto] bg-page text-fg">
      <ReportEditor
        name="Sample template"
        blocks={blocks}
        onBlocksChange={setBlocks}
        format={format}
        onFormatChange={setFormat}
        presets={<span>Presets are set by the screen that hosts the editor.</span>}
      />
      <pre data-testid="out" className="m-0 break-all whitespace-pre-wrap px-3 py-1 text-caption">
        {JSON.stringify({ blocks: toApiBlocks(blocks), format })}
      </pre>
    </div>
  );
}

export const Empty: Story = { render: () => <Harness start={[]} /> };

export const WithBlocks: Story = {
  render: () => (
    <Harness
      start={[
        createBlock("headline-numbers"),
        createBlock("region-metrics"),
        createBlock("confusion-matrix"),
      ]}
    />
  ),
};
