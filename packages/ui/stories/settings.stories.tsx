import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../src/components/button.tsx";
import {
  DeveloperDrawer,
  DeveloperNav,
  DevFigures,
  DevRow,
  DevStatus,
  DevToggle,
  DevZone,
  HudReadouts,
  PerformanceHud,
} from "../src/components/developer-drawer.tsx";
import { SegmentedControl } from "../src/components/segmented-control.tsx";
import {
  SettingScope,
  SettingsDialog,
  SettingsEmpty,
  SettingsFact,
  SettingsNav,
  SettingsNavItem,
  SettingsRow,
  SettingsRows,
} from "../src/components/settings-dialog.tsx";
import {
  AddKeyButton,
  KeyBinding,
  KeyCard,
  KeyFinder,
  KeyLegend,
  ShortcutGroup,
  ShortcutRow,
  UnboundKey,
} from "../src/components/shortcut-editor.tsx";
import { Switch } from "../src/components/switch.tsx";

const meta = {
  title: "Components/Settings",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function Nav({ query, setQuery }: { query: string; setQuery: (query: string) => void }) {
  return (
    <SettingsNav query={query} onQueryChange={setQuery}>
      <SettingsNavItem icon="sun" label="Display" current />
      <SettingsNavItem icon="sliders" label="Review" />
      <SettingsNavItem icon="panel" label="Layout" />
      <SettingsNavItem icon="keyboard" label="Shortcuts" />
      <SettingsNavItem icon="shield" label="Privacy and session" />
    </SettingsNav>
  );
}

function DisplaySection() {
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState("system");
  return (
    <SettingsDialog title="Display" nav={<Nav query={query} setQuery={setQuery} />}>
      <SettingsRows>
        <SettingsRow
          label="Theme"
          help="The interface only. Slides keep their own colors."
          scope="device"
        >
          <SegmentedControl
            fill
            aria-label="Theme"
            value={theme}
            onValueChange={(value) => setTheme(value as string)}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "System" },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label="Signature block on reports"
          help="Adds your name and role under the reports you sign."
          scope="personal"
        >
          <Switch defaultChecked aria-label="Signature block" />
        </SettingsRow>
        <SettingsRow
          label="Lock after"
          help="Set by your lab. Unlocking returns to the same view."
          scope="lab"
          fact
        >
          15 min
        </SettingsRow>
      </SettingsRows>
    </SettingsDialog>
  );
}

export const Dialog: Story = {
  render: () => (
    <div className="min-h-[720px]">
      <DisplaySection />
    </div>
  ),
};

export const Scopes: Story = {
  render: () => (
    <div className="flex gap-4">
      <SettingScope scope="personal" />
      <SettingScope scope="device" />
      <SettingScope scope="lab" />
    </div>
  ),
};

export const NoMatch: Story = {
  render: () => (
    <div className="w-[640px] bg-chrome">
      <SettingsEmpty query="xyz" onClear={() => undefined} />
    </div>
  ),
};

export const Facts: Story = {
  render: () => (
    <div className="w-[640px] bg-chrome p-4">
      <SettingsFact icon="user" label="Name">
        Lenka Malá
      </SettingsFact>
      <SettingsFact icon="mail" label="Email">
        l.mala@fnvltava.cz
      </SettingsFact>
    </div>
  ),
};

export const KeyStates: Story = {
  render: () => (
    <div className="flex items-center gap-2 bg-chrome p-4">
      <KeyBinding>J</KeyBinding>
      <KeyBinding state="mine">D</KeyBinding>
      <KeyBinding state="conflict">M</KeyBinding>
      <KeyBinding state="off">L</KeyBinding>
      <KeyBinding state="recording">Press a key</KeyBinding>
      <KeyBinding disabled title="Kept fixed so there is always a way back">
        Esc
      </KeyBinding>
      <UnboundKey />
      <AddKeyButton className="opacity-100" />
      <KeyLegend />
    </div>
  ),
};

export const Rows: Story = {
  render: () => (
    <div className="w-[690px] bg-chrome p-4">
      <KeyFinder listening={false} />
      <ShortcutGroup
        title="Deciding"
        where="in a review. The answer keys follow the task's decision style"
      >
        <ShortcutRow
          name="Agree"
          notes={["in the style Agree with the AI"]}
          keys={<KeyBinding>K</KeyBinding>}
          standard={<span>default</span>}
          source="new"
        />
        <ShortcutRow
          name="Ruler"
          keys={<KeyBinding state="mine">D</KeyBinding>}
          standard={
            <>
              <span>default L</span>
              <Button variant="link" size="xs">
                Reset
              </Button>
            </>
          }
          source="qp"
          highlight="found"
        />
      </ShortcutGroup>
    </div>
  ),
};

export const Cards: Story = {
  render: () => (
    <div className="grid w-[640px] gap-3 bg-chrome p-4">
      <KeyCard
        tone="recording"
        title="Press the new key for ruler"
        keys="Esc cancel ⌫ remove this key"
      >
        A key, or a key with ⌘, ⌃, ⌥ or ⇧.
      </KeyCard>
      <KeyCard
        tone="warn"
        title="M is already count marker in tools"
        actions={
          <>
            <Button>Swap: count marker gets L</Button>
            <Button variant="ghost">Cancel</Button>
          </>
        }
      >
        One key can only do one thing in the same place.
      </KeyCard>
      <KeyCard tone="bad" title="The browser keeps ⌘W" actions={<Button>Try another key</Button>}>
        It closes the browser tab, before the viewer can see the key.
      </KeyCard>
    </div>
  ),
};

function Drawer() {
  const [tab, setTab] = useState("renderer");
  const [hud, setHud] = useState(true);
  return (
    <div className="relative h-[640px] w-[960px] bg-canvas">
      {hud ? (
        <PerformanceHud
          route="viv · deck.gl webgl2"
          summary="60 fps · frame 6.2 ms"
          lines={[["source", "ome-zarr · 6.4 Gpx · 9 levels"]]}
        />
      ) : null}
      <DeveloperDrawer
        onClose={() => undefined}
        nav={
          <DeveloperNav
            value={tab}
            onValueChange={setTab}
            groups={[
              { title: "Viewer", items: [{ value: "renderer", label: "Renderer" }] },
              { title: "Measure", items: [{ value: "hud", label: "HUD" }] },
            ]}
          />
        }
        footer={<DevStatus live>viv · deck.gl webgl2 · IDR OME-Zarr</DevStatus>}
      >
        <DevZone title="HUD">
          <DevToggle
            label="Show the HUD"
            sub="Refreshes every 250 ms"
            checked={hud}
            onCheckedChange={setHud}
          />
          <DevRow label="Culling" hint="Only for WebGPU" disabled>
            <span>GPU compute</span>
          </DevRow>
          <DevFigures
            items={[
              ["6.2 ms", "frame p50"],
              ["60", "fps"],
            ]}
          />
        </DevZone>
        <DevZone title="Only on the WebGPU route" off note="Pick WebGPU to see these.">
          <HudReadouts
            boxes={[
              [
                "atlas",
                [
                  ["slots", "512"],
                  ["pinned", "24"],
                ],
              ],
            ]}
          />
        </DevZone>
      </DeveloperDrawer>
    </div>
  );
}

export const Developer: Story = { render: () => <Drawer /> };
