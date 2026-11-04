import type { Meta, StoryObj } from "@storybook/react-vite";
import { DecisionButtons } from "../src/components/decision-buttons.tsx";
import type { DecisionStyle } from "../src/lib/decision-answers.ts";
import { projectClasses } from "./fixtures.ts";

const meta = {
  title: "Components/Decision buttons",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const chosen: Record<DecisionStyle, string> = {
  certainty: "4",
  agree: "disagree",
  yesno: "yes",
  blind: "Stroma",
};

const styleNames: Record<DecisionStyle, string> = {
  certainty: "5-point certainty",
  agree: "Agree with the AI",
  yesno: "Yes or no",
  blind: "Pick the class blind",
};

const order: DecisionStyle[] = ["certainty", "agree", "yesno", "blind"];

function Board({ size }: { size: "large" | "compact" }) {
  return (
    <div
      className={
        size === "large" ? "grid w-[860px] grid-cols-2 gap-6" : "grid w-[680px] grid-cols-2 gap-6"
      }
    >
      {order.map((style) => (
        <section key={style} className="flex flex-col gap-2">
          <h3 className="text-body-sm font-semibold text-fg-dim">{styleNames[style]}</h3>
          <DecisionButtons
            decisionStyle={style}
            size={size}
            value={chosen[style]}
            classes={projectClasses}
            aiClass="Tumor"
            label={`${styleNames[style]}, ${size}`}
          />
        </section>
      ))}
    </div>
  );
}

export const FourStylesLarge: Story = { render: () => <Board size="large" /> };
export const FourStylesCompact: Story = { render: () => <Board size="compact" /> };
