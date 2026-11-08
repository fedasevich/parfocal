import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { BottomSheet } from "../src/components/bottom-sheet.tsx";
import type { SheetHeight } from "../src/lib/sheet-gesture.ts";

const meta = {
  title: "Components/Bottom sheet",
  component: BottomSheet,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BottomSheet>;

export default meta;

type Story = StoryObj<typeof meta>;

function Demo() {
  const [height, setHeight] = useState<SheetHeight>("peek");
  const [cell, setCell] = useState(1);
  return (
    <div className="relative h-screen overflow-hidden">
      <BottomSheet
        label="Inspector"
        height={height}
        onHeightChange={setHeight}
        onNextCell={() => setCell((value) => value + 1)}
        pixels={{ peek: 88, half: 300, full: 560 }}
      >
        <p className="p-4" data-testid="cell">
          Cell {cell}
        </p>
      </BottomSheet>
    </div>
  );
}

export const Default: Story = {
  args: { label: "Inspector", height: "peek", onHeightChange: () => undefined, children: null },
  render: () => <Demo />,
};
