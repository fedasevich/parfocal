import type { Meta, StoryObj } from "@storybook/react-vite";
import { Keycap, KeycapBindings } from "../src/components/keycap.tsx";

const meta = {
  title: "Foundations/Keycap",
  component: Keycap,
  args: { keys: "K" },
} satisfies Meta<typeof Keycap>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Keycap keys="K" size="sm" />
      <Keycap keys="⇧L" size="md" />
      <Keycap keys="⌘K" size="lg" />
    </div>
  ),
};

const personal: Record<string, string> = { dagree: "A", ddisagree: "D", dunsure: "" };

export const FromBindings: Story = {
  render: () => (
    <KeycapBindings label={(action) => personal[action]}>
      <div className="flex items-center gap-3 text-body-sm text-fg">
        Agree <Keycap action="dagree" keys="K" />
        Disagree <Keycap action="ddisagree" keys="X" />
        Not sure <Keycap action="dunsure" keys="U" />
        Next <Keycap action="dnext" keys="J" />
      </div>
    </KeycapBindings>
  ),
};
