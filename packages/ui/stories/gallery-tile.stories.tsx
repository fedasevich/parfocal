import type { Decision } from "@parfocal/tokens";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  GalleryTile,
  type GalleryTileSize,
  type GalleryTileState,
} from "../src/components/gallery-tile.tsx";
import { mayNotBeNucleus } from "../src/lib/not-a-nucleus.ts";
import { mockAssets } from "./fixtures.ts";

const meta = {
  title: "Components/Gallery tile",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const sizes: GalleryTileSize[] = [92, 120];

const cropAt = (index: number) => ({
  imagePosition: `${-(index % 13) * 120}px ${-Math.floor(index / 13) * 160}px`,
  imageSize: "2240px 1400px",
});

function Row({
  state,
  decision = "open",
  label,
}: {
  state: GalleryTileState;
  decision?: Decision;
  label: string;
}) {
  return (
    <div className="flex items-start gap-6 bg-chrome p-4">
      {sizes.map((size, index) => (
        <GalleryTile
          key={size}
          size={size}
          image={mockAssets.hpf}
          objectId={`T1·C14${index + 5}`}
          label={label}
          state={state}
          decision={decision}
          {...cropAt(index + 3)}
        />
      ))}
    </div>
  );
}

export const ToCheck: Story = {
  render: () => <Row state="to-check" label="probably tumor" />,
};

export const Current: Story = {
  render: () => <Row state="current" label="tumor or immune" />,
};

export const Done: Story = {
  render: () => <Row state="done" decision="agree" label="tumor 82%" />,
};

export const DoneEachDecision: Story = {
  render: () => (
    <div className="flex items-start gap-6 bg-chrome p-4">
      {(["agree", "disagree", "unsure"] as const).map((decision, index) => (
        <GalleryTile
          key={decision}
          image={mockAssets.hpf}
          objectId={`T1·C15${index}`}
          label="8 in 10 like this are tumor"
          state="done"
          decision={decision}
          {...cropAt(index + 7)}
        />
      ))}
    </div>
  ),
};

const pickable = [
  { objectId: "T1·C160", label: "probably tumor" },
  { objectId: "T1·C161", label: "tumor or immune" },
  { objectId: "T1·C162", label: "probably immune" },
];

function Pickable() {
  const [current, setCurrent] = useState(pickable[0]?.objectId);
  const [done, setDone] = useState<Record<string, Decision>>({});
  return (
    <div className="grid gap-3 bg-chrome p-4">
      <div className="flex items-start gap-4">
        {pickable.map((cell, index) => {
          const decision = done[cell.objectId] ?? "open";
          const state: GalleryTileState =
            cell.objectId === current ? "current" : decision === "open" ? "to-check" : "done";
          return (
            <GalleryTile
              key={cell.objectId}
              image={mockAssets.hpf}
              objectId={cell.objectId}
              label={cell.label}
              state={state}
              decision={decision}
              onClick={() => setCurrent(cell.objectId)}
              {...cropAt(index + 10)}
            />
          );
        })}
      </div>
      <button
        type="button"
        className="w-fit rounded-md bg-chrome-2 px-3 py-1 text-body-sm text-fg"
        onClick={() => {
          if (!current) return;
          setDone((all) => ({ ...all, [current]: "agree" }));
          const next = pickable.find((cell) => cell.objectId !== current && !done[cell.objectId]);
          setCurrent(next?.objectId);
        }}
      >
        Agree
      </button>
    </div>
  );
}

export const PickAndDecide: Story = {
  render: () => <Pickable />,
};

function Flagged() {
  const [marked, setMarked] = useState<string[]>([]);
  const cells = [
    { objectId: "T1·C170", detectorScore: 0.74, foreground: 0.92 },
    { objectId: "T1·C171", detectorScore: 0.93, foreground: 0.31 },
    { objectId: "T1·C172", detectorScore: 0.95, foreground: 0.9 },
  ];
  return (
    <div className="flex items-start gap-6 bg-chrome p-4">
      {cells.map((cell, index) => {
        const decision = marked.includes(cell.objectId) ? "disagree" : "open";
        return (
          <GalleryTile
            key={cell.objectId}
            size={40}
            image={mockAssets.hpf}
            objectId={cell.objectId}
            label="tumor cell"
            state={decision === "open" ? "to-check" : "done"}
            decision={decision}
            flagged={mayNotBeNucleus(cell)}
            onFlagAction={() => setMarked((all) => [...all, cell.objectId])}
            {...cropAt(index + 5)}
          />
        );
      })}
    </div>
  );
}

export const MayNotBeANucleus: Story = {
  render: () => <Flagged />,
};
