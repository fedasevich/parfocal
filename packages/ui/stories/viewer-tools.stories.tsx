import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  MapArea,
  MapDots,
  type MapImage,
  MapOutline,
  type MapRect,
  MapRoute,
  MapTrail,
  MapViewport,
  PeekArea,
  PeekHere,
  SmartMinimap,
  WholeSlidePeek,
} from "../src/components/smart-minimap.tsx";
import { StatusTag } from "../src/components/tag.tsx";
import {
  CellHud,
  ContextBar,
  ContextDivider,
  ContextPill,
  Crosshair,
  DistanceCue,
  FloatingPill,
  FocusCard,
  LayerList,
  PaneHeader,
  PanePicker,
  RulerLine,
  SideToggles,
  SlideSlot,
  SlidesOnScreenPanel,
  type Tier,
  TierPicker,
  TierPill,
} from "../src/components/viewer-tools.tsx";
import { mockAssets } from "./fixtures.ts";

const meta = {
  title: "Components/Viewer tools",
  decorators: [
    (Story) => (
      <div className="bg-chrome p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const overview: MapImage = { src: mockAssets.overview, width: 1400, height: 1924 };

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${2 * rx},0a${rx},${ry} 0 1,0 ${-2 * rx},0Z`;

const areas = [
  { label: "1", path: ellipse(259, 1565, 190, 270), centre: [259, 1565] as [number, number] },
  { label: "2", path: ellipse(1075, 1018, 215, 160), centre: [1075, 1018] as [number, number] },
  { label: "3", path: ellipse(1248, 130, 40, 44), centre: [1248, 130] as [number, number] },
];

const viewport: MapRect = [835, 950, 84, 68];

const trail: MapRect[] = [
  [142, 1469, 84, 68],
  [217, 1469, 84, 68],
  [142, 1531, 84, 68],
  [217, 1531, 84, 68],
  [400, 1300, 84, 68],
  [620, 1130, 84, 68],
];

function Stage({ children, height = 360 }: { children: React.ReactNode; height?: number }) {
  return (
    <div
      className="relative overflow-hidden rounded-zone bg-[#262626]"
      style={{ width: 560, height }}
    >
      {children}
    </div>
  );
}

export const MinimapReading: Story = {
  render: () => (
    <Stage>
      <SmartMinimap
        image={overview}
        title={
          <>
            <b>Whole slide</b> · 21% seen
          </>
        }
        foot="T2 of 5"
        footEnd="10× · 1 of 5 decided"
        onOpen={() => undefined}
        style={{ right: 12, bottom: 12 }}
      >
        <MapTrail rects={trail} />
        {areas.map((area, index) => (
          <MapArea
            key={area.label}
            {...area}
            badge={index === 0 ? "checked" : index === 1 ? "current" : "open"}
          />
        ))}
        <MapViewport rect={viewport} />
      </SmartMinimap>
    </Stage>
  ),
};

export const MinimapTravelling: Story = {
  render: () => (
    <Stage height={440}>
      <SmartMinimap
        size="travel"
        image={overview}
        title={
          <>
            <b>Going to area 3</b> · 13.2 mm
          </>
        }
        foot="Press ] again to skip"
        onOpen={() => undefined}
        style={{ right: 12, bottom: 12 }}
      >
        <MapTrail rects={trail} />
        {areas.map((area) => (
          <MapArea key={area.label} {...area} />
        ))}
        <MapRoute from={[877, 984]} to={[1248, 130]} />
        <MapViewport rect={viewport} />
      </SmartMinimap>
    </Stage>
  ),
};

const areaExtent: MapRect = [805, 804, 541, 428];

export const MinimapCellsInAnArea: Story = {
  render: () => (
    <Stage>
      <SmartMinimap
        size="compact"
        image={overview}
        extent={areaExtent}
        foot="Area 2"
        footEnd="4 of 12 checked"
        onOpen={() => undefined}
        style={{ right: 12, bottom: 12 }}
      >
        <MapOutline path={areas[1]?.path ?? ""} />
        <MapDots
          dots={[
            [1233, 988],
            [1083, 1007],
            [1063, 947],
            [952, 1087],
            [868, 984],
            [918, 979],
          ]}
          done={4}
          current={4}
        />
        <MapViewport rect={[860, 978, 16, 10]} />
      </SmartMinimap>
    </Stage>
  ),
};

export const MinimapLocator: Story = {
  render: () => (
    <Stage>
      <SmartMinimap
        size="pip"
        image={overview}
        extent={areaExtent}
        onOpen={() => undefined}
        style={{ right: 12, bottom: 12 }}
      >
        <MapOutline path={areas[1]?.path ?? ""} />
        <MapDots
          dots={[
            [1233, 988],
            [1083, 1007],
            [868, 984],
          ]}
          done={1}
          current={2}
        />
      </SmartMinimap>
    </Stage>
  ),
};

export const MinimapFadedUnderThePointer: Story = {
  render: () => (
    <Stage>
      <SmartMinimap
        faded
        image={overview}
        title={
          <>
            <b>Whole slide</b> · 21% seen
          </>
        }
        foot="T2 of 5"
        footEnd="10×"
        onOpen={() => undefined}
        style={{ right: 12, bottom: 12 }}
      >
        <MapViewport rect={viewport} />
      </SmartMinimap>
    </Stage>
  ),
};

export const MinimapWithoutClick: Story = {
  render: () => (
    <Stage>
      <SmartMinimap
        size="compact"
        image={overview}
        foot="A1 · H&E"
        footEnd="Click to move"
        style={{ left: 12, top: 12 }}
      >
        {areas.map((area) => (
          <MapArea key={area.label} {...area} />
        ))}
        <MapViewport rect={viewport} />
      </SmartMinimap>
    </Stage>
  ),
};

export const WholeSlide: Story = {
  render: () => (
    <div className="relative h-[760px] w-[900px]">
      <WholeSlidePeek
        image={overview}
        sub="A1 · H&E · 5 tumor regions, 4 decided · 26% of tissue seen"
        onClose={() => undefined}
      >
        <MapTrail rects={trail} opacity={0.28} />
        {areas.map((area, index) => (
          <PeekArea
            key={area.label}
            path={area.path}
            corner={[area.centre[0] + 150, area.centre[1] - 150]}
            label={area.label}
            checked={index === 0}
          />
        ))}
        <PeekHere rect={viewport} />
      </WholeSlidePeek>
    </div>
  ),
};

export const DistanceCues: Story = {
  render: () => (
    <Stage height={120}>
      <DistanceCue label="T1" distance="12.0 mm" direction="back" style={{ left: 14, top: 20 }} />
      <DistanceCue
        label="Area 3"
        distance="13.2 mm"
        direction="next"
        active
        style={{ right: 14, top: 66 }}
      />
    </Stage>
  ),
};

export const Ruler: Story = {
  render: () => (
    <Stage height={260}>
      <RulerLine from={{ x: 120, y: 200 }} to={{ x: 420, y: 120 }} label="1.62 mm" />
      <RulerLine dashed from={{ x: 280, y: 40 }} to={{ x: 280, y: 240 }} label="8.00 mm" />
    </Stage>
  ),
};

const tiers: Tier[] = [
  {
    name: "Best",
    description: "The most accurate outlines. Slowest, runs on the hospital server.",
    model: "PathoSAM ViT-B · AIS decoder · v1.2",
    speed: 1,
    colour: "var(--ok)",
  },
  {
    name: "Good",
    description: "Nearly as accurate, about three times quicker.",
    model: "HoVer-Net · MONAI Label · v0.9",
    speed: 2,
    colour: "var(--accent)",
  },
  {
    name: "Fast",
    description: "A quick draft that runs on this computer, also offline.",
    model: "SlimSAM-77 · ONNX in the browser · v1.0",
    speed: 3,
    colour: "var(--warn)",
  },
];

export const AutoRegionBar: Story = {
  render: () => (
    <Stage height={90}>
      <ContextBar label="Auto region">
        <TierPill tier={tiers[0] as Tier} />
        <ContextPill>nuclei · 0.25 µm</ContextPill>
        <ContextDivider />
        <span className="font-mono">46 found</span>
      </ContextBar>
    </Stage>
  ),
};

export const ModelTierPicker: Story = {
  render: function Render() {
    const [value, setValue] = useState("Best");
    return (
      <div className="relative h-[440px] w-[460px]">
        <TierPicker
          className="top-0 left-0"
          title="Model for outlining nuclei"
          tiers={tiers}
          value={value}
          onValueChange={setValue}
          onClose={() => undefined}
          note="The full model name shows when you point at a tier. Your lab decides which model each tier uses, and the report always records the exact model and version."
        />
      </div>
    );
  },
};

export const EditableLayers: Story = {
  render: function Render() {
    const [hidden, setHidden] = useState<string[]>([]);
    const [locked, setLocked] = useState<string[]>(["margin"]);
    const [target, setTarget] = useState("tumor");
    const [colour, setColour] = useState("#f87171");
    const flip = (list: string[], set: (next: string[]) => void, key: string) =>
      set(list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);
    return (
      <div className="w-80">
        <LayerList
          hidden={hidden}
          onToggle={(key) => flip(hidden, setHidden, key)}
          onLock={(key) => flip(locked, setLocked, key)}
          onColour={(_, hex) => setColour(hex)}
          onPick={setTarget}
          rows={[
            {
              key: "tumor",
              name: "Tumor",
              colour,
              count: 12,
              locked: locked.includes("tumor"),
              target: target === "tumor",
              hasChildren: true,
            },
            {
              key: "margin",
              name: "Margin",
              colour: "#38bdf8",
              count: 4,
              depth: 1,
              locked: locked.includes("margin"),
              target: target === "margin",
              inheritedOff: hidden.includes("tumor"),
            },
            {
              key: "ungrouped",
              name: "Ungrouped",
              colour: "var(--fg-faint)",
              count: 3,
              plain: true,
            },
          ]}
        />
      </div>
    );
  },
};

export const Layers: Story = {
  render: function Render() {
    const [hidden, setHidden] = useState<string[]>(["stroma"]);
    return (
      <div className="w-80">
        <LayerList
          hidden={hidden}
          onToggle={(key) =>
            setHidden(
              hidden.includes(key) ? hidden.filter((item) => item !== key) : [...hidden, key],
            )
          }
          rows={[
            {
              key: "nuclei",
              name: "Area 2 tumor nuclei",
              colour: "var(--c-tumor)",
              count: 412,
              locked: true,
            },
            { key: "reviewed", name: "Reviewed", colour: "var(--c-tumor)", count: 48, child: true },
            {
              key: "job",
              name: "From whole-slide job",
              colour: "var(--c-tumor)",
              count: 364,
              child: true,
            },
            {
              key: "proposals",
              name: "Proposals, not saved",
              colour: "var(--c-prop)",
              proposal: true,
              count: 46,
              current: true,
            },
            { key: "immune", name: "Immune", colour: "var(--c-immune)", count: 465 },
            { key: "stroma", name: "Stroma", colour: "var(--c-stroma)", count: 32 },
          ]}
        />
      </div>
    );
  },
};

const he = { backgroundImage: `url(${mockAssets.overview})` };
const ck = {
  backgroundImage: `url(${mockAssets.overview})`,
  filter: "grayscale(1) sepia(.85) hue-rotate(-12deg) saturate(1.5)",
};

export const ComparePanePicker: Story = {
  render: () => (
    <Stage height={360}>
      <PaneHeader
        side="right"
        open
        slide={{ key: "ck", name: "A3 · CK", thumb: ck, simulated: true }}
      />
      <PanePicker
        side="right"
        onPick={() => undefined}
        slides={[
          {
            key: "a1",
            name: "A1 · H&E",
            thumb: he,
            note: "On the left now, picking it swaps the sides",
            here: false,
          },
          {
            key: "a2",
            name: "A2 · H&E",
            thumb: { ...he, transform: "scaleX(-1)" },
            note: "Click to show here",
            here: false,
          },
          {
            key: "ck",
            name: "A3 · CK",
            thumb: ck,
            simulated: true,
            note: "Showing here",
            here: true,
          },
        ]}
      />
      <Crosshair x={460} y={300} />
    </Stage>
  ),
};

export const SlidesOnScreen: Story = {
  render: function Render() {
    const [rows, setRows] = useState([
      { key: "outline", name: "Tumor map outline", left: true, right: false },
      { key: "measurements", name: "Measurements", left: true, right: false },
      { key: "comments", name: "Comments", left: true, right: true },
    ]);
    return (
      <div className="grid w-80 gap-2">
        <SlideSlot
          side="left"
          slide={{ key: "a1", name: "A1 · H&E", thumb: he }}
          note="The slide you were reading"
          onChange={() => undefined}
        />
        <SlideSlot
          side="right"
          slide={{ key: "ck", name: "A3 · CK", thumb: ck }}
          note="Cytokeratin, marks tumor cells brown"
          onChange={() => undefined}
        />
        <SideToggles
          rows={rows}
          onToggle={(key, side) =>
            setRows(rows.map((row) => (row.key === key ? { ...row, [side]: !row[side] } : row)))
          }
        />
      </div>
    );
  },
};

export const SlidesOnScreenPanelStates: Story = {
  render: () => (
    <div className="grid w-80 gap-6">
      <SlidesOnScreenPanel
        left={{
          slide: { key: "a1", name: "A1 · H&E", thumb: he },
          note: "The slide you were reading",
        }}
        right={{
          slide: { key: "ck", name: "A3 · CK", thumb: ck },
          note: "Cytokeratin, marks tumor cells brown",
        }}
        onChange={() => undefined}
        onSwap={() => undefined}
      />
      <SlidesOnScreenPanel
        left={{
          slide: { key: "a1", name: "A1 · H&E", thumb: he },
          note: "Only slide of this case",
        }}
        onChange={() => undefined}
        onSwap={() => undefined}
      />
      <SlidesOnScreenPanel
        left={{
          slide: {
            key: "long",
            name: "Sentinel lymph node 2, left axilla, level 3 · H&E",
            thumb: he,
          },
          note: "A long note that wraps: scanned on the second scanner after the rescan request",
        }}
        right={{
          slide: { key: "ck", name: "A3 · CK", thumb: ck, simulated: true },
          note: "Simulated stain",
        }}
        onChange={() => undefined}
        onSwap={() => undefined}
      />
    </div>
  ),
};

export const FocusMode: Story = {
  render: () => (
    <Stage height={300}>
      <FloatingPill>
        <b>S26-04812</b>
        <span className="text-fg-faint">A1 · T5 · 10×</span>
      </FloatingPill>
      <FocusCard
        className="right-3 bottom-3"
        title="T5 · Tumor region"
        status={<StatusTag tone="neutral">open</StatusTag>}
        text="0.41 mm across. Still open."
        keys={[
          { key: "K", label: "agree" },
          { key: "X", label: "disagree" },
          { key: "U", label: "not sure" },
          { key: "⌘\\", label: "show UI" },
        ]}
      />
    </Stage>
  ),
};

export const CellUnderReview: Story = {
  render: () => (
    <Stage height={220}>
      <CellHud
        className="bottom-4"
        title={'Cell 6 of 12 · AI says "tumor or immune"'}
        where="area 2"
        keys={[
          { key: "K", label: "Keep", main: true },
          { key: "1", label: "tumor" },
          { key: "3", label: "immune" },
          { key: "J", label: "skip" },
        ]}
      />
    </Stage>
  ),
};
