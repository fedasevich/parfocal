import type { Meta, StoryObj } from "@storybook/react-vite";
import { GalleryTile } from "../src/components/gallery-tile.tsx";
import { AiCallLine, InspectorCard } from "../src/components/inspector.tsx";
import {
  type TypeCall,
  type TyperEvidence,
  unmeasuredTyper,
  type WordingSetting,
} from "../src/lib/confidence-words.ts";
import { mockAssets } from "./fixtures.ts";

const meta = {
  title: "Components/AI wording",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const measured: TyperEvidence = {
  name: "Measured typer",
  calibrated: true,
  checkedOnHeldOut: true,
  bandAccuracy: { confident: 0.95, likely: 0.72, unsure: 0.51, doubtful: 0.44 },
};

const calls: TypeCall[] = [
  { label: "tumor", probability: 0.72 },
  { label: "immune", probability: 0.2 },
  { label: "stroma", probability: 0.08 },
];

const settings: WordingSetting[] = ["words", "numbers", "frequency", "colour", "hidden"];

function Modes({ typer }: { typer: TyperEvidence }) {
  return (
    <div className="grid gap-4 bg-chrome p-4">
      {settings.map((wording, index) => (
        <div key={wording} data-setting={wording} className="flex items-start gap-4">
          <GalleryTile
            image={mockAssets.hpf}
            objectId={`T1·C14${index}`}
            label="cell"
            ai={{ calls, typer, wording }}
          />
          <InspectorCard className="w-64">
            <AiCallLine calls={calls} typer={typer} wording={wording} />
          </InspectorCard>
        </div>
      ))}
    </div>
  );
}

export const EachSetting: Story = {
  render: () => <Modes typer={measured} />,
};

export const UncalibratedTyper: Story = {
  render: () => <Modes typer={unmeasuredTyper("New typer")} />,
};
