import { type MotionMode, motionDurationsMs, motionEasings, motionMs } from "@parfocal/tokens";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../src/components/button.tsx";

function MotionDemo({ mode }: { mode: MotionMode }) {
  const [moved, setMoved] = useState(false);
  return (
    <div data-motion={mode} className="grid w-[640px] gap-5 text-fg">
      <table className="text-body-sm">
        <thead>
          <tr className="text-left text-fg-dim">
            <th className="pr-6 font-semibold">Token</th>
            <th className="pr-6 font-semibold">Base</th>
            <th className="font-semibold">In this mode</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {Object.entries(motionDurationsMs).map(([name, ms]) => (
            <tr key={name}>
              <td className="pr-6">--motion-{name}</td>
              <td className="pr-6">{ms} ms</td>
              <td>{motionMs(name as keyof typeof motionDurationsMs, mode)} ms</td>
            </tr>
          ))}
          {Object.entries(motionEasings).map(([name, curve]) => (
            <tr key={name}>
              <td className="pr-6">--motion-ease-{name}</td>
              <td colSpan={2}>cubic-bezier({curve.join(", ")})</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-4">
        <Button onClick={() => setMoved((value) => !value)}>Move</Button>
        <div className="h-10 w-[360px] rounded-ctl bg-chrome-2">
          <div
            data-testid="mover"
            className="size-10 rounded-ctl bg-accent-fill transition-transform duration-(--motion-slow) ease-standard"
            style={{ transform: moved ? "translateX(320px)" : "none" }}
          />
        </div>
      </div>
      {moved ? (
        <p
          data-testid="entering"
          className="animate-in fade-in-0 duration-(--motion-base) text-body-sm text-fg-dim"
        >
          Moved
        </p>
      ) : null}
    </div>
  );
}

const meta = {
  title: "Components/Motion",
  component: MotionDemo,
  decorators: [
    (Story) => (
      <div className="rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MotionDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Normal: Story = { args: { mode: "normal" } };

export const Presenting: Story = { args: { mode: "presenting" } };

export const Reduced: Story = { args: { mode: "reduced" } };
