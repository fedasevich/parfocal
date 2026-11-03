import { type SurfaceLevel, surfaceLevels } from "@parfocal/tokens";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../src/components/button.tsx";
import { JobWindow } from "../src/components/job-window.tsx";
import { Switch } from "../src/components/switch.tsx";
import { FoldingZone, Hint, Surface, Zone, Zones } from "../src/components/zone.tsx";

const levelWords: Record<SurfaceLevel, { name: string; use: string }> = {
  page: { name: "Page", use: "The background behind everything" },
  panel: { name: "Panel", use: "A panel or modal body, one step up" },
  section: { name: "Section", use: "A zone inside a panel, one more step up" },
  highlight: { name: "Highlight", use: "The part that needs attention now" },
};

function Levels() {
  return (
    <div className="grid gap-4">
      {(["dark", "light"] as const).map((theme) => (
        <Surface
          key={theme}
          level="page"
          data-theme={theme}
          data-testid={`levels-${theme}`}
          className="grid gap-3 rounded-zone border border-line p-4"
        >
          <span className="text-label font-semibold tracking-[0.07em] text-fg-faint uppercase">
            {theme}
          </span>
          <div className="grid grid-cols-4 gap-3">
            {surfaceLevels.map((level) => (
              <Surface
                key={level}
                level={level}
                data-testid={`level-${theme}-${level}`}
                className="grid h-24 content-end gap-0.5 rounded-zone border border-surf-edge p-3"
              >
                <b className="text-body">{levelWords[level].name}</b>
                <span className="text-caption text-fg-dim">{levelWords[level].use}</span>
              </Surface>
            ))}
          </div>
          <Surface level="panel" className="rounded-zone border border-surf-edge p-(--pad-zone)">
            <Zones>
              <Zone title="Section" sub="A zone one step above its panel">
                <Hint>Settings that belong together sit on one background.</Hint>
              </Zone>
              <Zone title="Highlight" sub="Only the part that needs attention now" highlight>
                <Hint>Three objects still have no decision.</Hint>
              </Zone>
            </Zones>
          </Surface>
        </Surface>
      ))}
    </div>
  );
}

function ZonedModal() {
  return (
    <Surface level="page" className="h-screen">
      <JobWindow
        open
        title="Start a run"
        subtitle="PathoSAM v1.2 on 12 slides"
        footer={
          <>
            <span className="flex-1 text-body-sm text-fg-dim">About 4 minutes</span>
            <Button variant="outline">Cancel</Button>
            <Button>Start run</Button>
          </>
        }
      >
        <Zone title="Slides" sub="12 slides from Case 0001">
          <Hint>Every slide is ready. None was run with this model before.</Hint>
          <Hint>Results land in a new result set.</Hint>
        </Zone>
        <Zone title="Needs attention" sub="Two slides have a pen mark" highlight>
          <Hint>The model skips marked areas. Check them after the run.</Hint>
          <Hint>Slides A2 and B1.</Hint>
        </Zone>
        <FoldingZone title="Display" summary="Outline 2 px · by class · IDs on">
          <label className="flex items-center justify-between gap-3 text-body">
            ID labels
            <Switch defaultChecked />
          </label>
          <Hint>How results draw on the slide.</Hint>
        </FoldingZone>
      </JobWindow>
    </Surface>
  );
}

const meta = {
  title: "Components/Surfaces",
  component: Levels,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Levels>;

export default meta;

type Story = StoryObj<typeof meta>;

export const EveryLevel: Story = {};

export const ModalWithThreeZones: Story = { render: () => <ZonedModal /> };
