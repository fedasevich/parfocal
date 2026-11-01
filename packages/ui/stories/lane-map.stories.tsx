import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  LaneMap,
  LaneMapArrows,
  LaneMapBox,
  LaneMapHeader,
  LaneMapLane,
  LaneMapPill,
  LaneMapText,
} from "../src/components/lane-map.tsx";
import { Person } from "../src/components/person.tsx";
import { avatarColour } from "../src/lib/avatar-colours.ts";

const meta = {
  title: "Patterns/Lane map",
  component: LaneMap,
  parameters: { layout: "fullscreen" },
  args: { width: 760, height: 430 },
} satisfies Meta<typeof LaneMap>;

export default meta;

type Story = StoryObj<typeof meta>;

const daniel = { initials: "DH", name: "Daniel Hruška", color: avatarColour(8) };
const lenka = { initials: "LM", name: "Lenka Malá", color: avatarColour(0) };

export const TwoLanesWithAHandOff: Story = {
  render: (args) => (
    <LaneMap {...args} className="m-4 rounded-zone border border-line">
      <LaneMapHeader
        title="How a review works"
        description="A plain arrow is the next step by the same person. An arrow with a label is a hand-off."
      />
      <LaneMapLane
        top={82}
        height={124}
        title="Researcher"
        note="Sets up the review"
        people={<Person person={daniel} size={20} />}
      />
      <LaneMapLane
        top={240}
        height={124}
        title="Reviewer"
        people={<Person person={lenka} size={20} />}
      />
      <LaneMapArrows
        width={760}
        height={430}
        arrows={[
          {
            d: "M161 156 H175",
            kind: "step",
            heads: [{ x: 175, y: 156, direction: "r" }],
          },
          {
            d: "M299 156 H451",
            kind: "wait",
            heads: [{ x: 451, y: 156, direction: "r" }],
          },
          {
            d: "M237 199 V271",
            kind: "hand",
            heads: [{ x: 237, y: 271, direction: "d" }],
          },
        ]}
      />
      <LaneMapBox x={40} y={116} w={118} h={80} title="Upload" sub="Slides and results" />
      <LaneMapBox x={178} y={116} w={118} h={80} title="New review task" sub="5 steps" />
      <LaneMapBox
        x={454}
        y={116}
        w={256}
        h={80}
        title="Disagreements"
        sub="Not built yet, shown dim"
        dim
      />
      <LaneMapBox x={178} y={274} w={118} h={80} title="My work" sub="Tasks and due dates" />
      <LaneMapPill x={237} y={223}>
        Task sent
      </LaneMapPill>
      <LaneMapText x={299} y={132} w={152} align="center">
        Reviewers work on their slides
      </LaneMapText>
      <LaneMapText x={340} y={274} w={380}>
        A note sits in a lane as plain text, like the clinical note of the mock's map.
      </LaneMapText>
    </LaneMap>
  ),
};
