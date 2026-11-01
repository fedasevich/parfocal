import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../src/components/combobox.tsx";

const meta = {
  title: "Controls/Combobox",
  component: Combobox,
} satisfies Meta<typeof Combobox>;

export default meta;

type Story = StoryObj<typeof meta>;

const reviewers = ["Dr. Ana Kovač", "Dr. Ben Okafor", "Dr. Chen Wei", "Dr. Dana Levi"];

function Example({ open }: { open: boolean }) {
  return (
    <Combobox items={reviewers} defaultOpen={open}>
      <ComboboxInput placeholder="Find a reviewer" aria-label="Reviewer" className="w-64" />
      <ComboboxContent>
        <ComboboxEmpty>No reviewer matches.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export const Closed: Story = {
  render: () => <Example open={false} />,
};

export const Open: Story = {
  render: () => <Example open />,
};
