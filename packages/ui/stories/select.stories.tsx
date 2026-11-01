import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../src/components/select.tsx";

const meta = {
  title: "Controls/Select",
  component: Select,
} satisfies Meta<typeof Select>;

export default meta;

type Story = StoryObj<typeof meta>;

const classes = [
  { label: "Tumour", value: "tumour" },
  { label: "Stroma", value: "stroma" },
  { label: "Immune", value: "immune" },
  { label: "Other", value: "other" },
];

function Example({ open }: { open: boolean }) {
  return (
    <Select items={classes} defaultValue="stroma" defaultOpen={open}>
      <SelectTrigger className="w-44" aria-label="Cell class">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Cell class</SelectLabel>
          {classes.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export const Closed: Story = {
  render: () => <Example open={false} />,
};

export const Open: Story = {
  render: () => <Example open />,
};
