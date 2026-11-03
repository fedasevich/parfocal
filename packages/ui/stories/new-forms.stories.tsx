import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { NewCaseForm, NewProjectForm } from "../src/components/new-forms.tsx";
import type { NewCaseValues, NewProjectValues, TaxonomyOption } from "../src/lib/new-forms.ts";

const meta = {
  title: "Components/New project and case",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const taxonomies: TaxonomyOption[] = [
  {
    id: "sentinel-node",
    name: "Sentinel node",
    classes: [
      { key: 1, name: "Tumor", colour: "#d9534f" },
      { key: 2, name: "Stroma", colour: "#5b8fd9" },
      { key: 3, name: "Immune", colour: "#4aa66b" },
    ],
  },
  {
    id: "pannuke",
    name: "PanNuke",
    classes: [
      { key: 1, name: "Neoplastic", colour: "#d9534f" },
      { key: 2, name: "Inflammatory", colour: "#4aa66b" },
      { key: 3, name: "Connective", colour: "#5b8fd9" },
      { key: 4, name: "Dead", colour: "#d9a441" },
      { key: 5, name: "Epithelial", colour: "#43999d" },
    ],
  },
];

function Frame({ result, children }: { result: unknown; children: ReactNode }) {
  return (
    <div className="relative h-[760px] bg-page text-fg">
      {children}
      <pre data-testid="submitted" className="m-3 text-body-sm">
        {result === undefined ? "nothing submitted" : JSON.stringify(result)}
      </pre>
    </div>
  );
}

function ProjectHarness() {
  const [result, setResult] = useState<NewProjectValues | undefined>(undefined);
  return (
    <Frame result={result}>
      <NewProjectForm code="P12" taxonomies={taxonomies} onCreate={setResult} onClose={() => {}} />
    </Frame>
  );
}

function CaseHarness({ privacy }: { privacy: "de-identified" | "clinical" }) {
  const [result, setResult] = useState<NewCaseValues | undefined>(undefined);
  return (
    <Frame result={result}>
      <NewCaseForm
        project={{ code: privacy === "clinical" ? "P03" : "P07", name: "Lymph nodes", privacy }}
        onCreate={setResult}
        onClose={() => {}}
      />
    </Frame>
  );
}

export const NewProject: Story = {
  render: () => <ProjectHarness />,
};

export const NewCaseDeidentified: Story = {
  render: () => <CaseHarness privacy="de-identified" />,
};

export const NewCaseClinical: Story = {
  render: () => <CaseHarness privacy="clinical" />,
};
