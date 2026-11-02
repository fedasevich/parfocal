import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { FilterChip, type FilterOption } from "../src/components/filter-chip.tsx";

const meta = {
  title: "Controls/Filter chip",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const statuses: FilterOption[] = [
  { value: "ready", label: "Ready" },
  { value: "in-review", label: "In review" },
  { value: "submitted", label: "Submitted" },
  { value: "signed-off", label: "Signed off" },
];

const projects: FilterOption[] = [
  { value: "p07", label: "Lymph node metastasis study", hint: "P07" },
  { value: "p09", label: "Prostate grading benchmark", hint: "P09" },
  { value: "p11", label: "Kidney biopsy triage", hint: "P11" },
  { value: "p12", label: "Breast margin pilot", hint: "P12" },
  { value: "p13", label: "Colon polyp review", hint: "P13" },
  { value: "p14", label: "Skin lesion calibration", hint: "P14" },
  { value: "p15", label: "Liver fibrosis staging", hint: "P15" },
];

function Chip({
  label,
  options,
  start,
  open,
  anyLabel,
}: {
  label: string;
  options: FilterOption[];
  start?: string;
  open?: boolean;
  anyLabel?: string;
}) {
  const [value, setValue] = useState(start);
  return (
    <div className="flex h-80 w-80 items-start">
      <FilterChip
        label={label}
        options={options}
        value={value}
        onValueChange={setValue}
        {...(open ? { defaultOpen: true } : {})}
        {...(anyLabel ? { anyLabel } : {})}
      />
    </div>
  );
}

export const Closed: Story = {
  render: () => <Chip label="Status" options={statuses} />,
};

export const Open: Story = {
  render: () => <Chip label="Status" options={statuses} open />,
};

export const Chosen: Story = {
  render: () => <Chip label="Status" options={statuses} start="in-review" />,
};

export const WithSearch: Story = {
  render: () => <Chip label="Project" anyLabel="all" options={projects} open />,
};

export const NoOptions: Story = {
  render: () => <Chip label="Reviewer" options={[]} open />,
};
