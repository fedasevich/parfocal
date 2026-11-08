import { Button } from "@parfocal/ui/components/button";
import { GalleryTile } from "@parfocal/ui/components/gallery-tile";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { Zone } from "@parfocal/ui/components/zone";
import { useBindings } from "../../keys/personal-keys.ts";
import type { Fired } from "../../keys/registry.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { reviewTyper } from "../review/ai-wording.ts";
import { inLayer } from "../review/answer-keys.ts";
import { CellOutline, cropStyle } from "../review/cells-grid.tsx";
import type { Answer } from "../review/review-state.ts";
import { lookUrl } from "../thumbnails.ts";
import type { CellZone } from "./zone-cells.ts";

const restActions = ["drest"];

export function useRestKey(onRest: () => void, enabled: boolean) {
  const bindings = useBindings(["review"], restActions, enabled);
  useHotkeys(bindings, (fired: Fired) => {
    if (fired.phase === "press" && !inLayer()) onRest();
  });
}

type ZoneGalleryProps = {
  zones: CellZone[];
  openId: string | null;
  current: string | undefined;
  answer: (object: string) => Answer | undefined;
  disabledReason: string | undefined;
  onOpen: (zoneId: string | null) => void;
  onPick: (object: string) => void;
  onNext: () => void;
  onRest: () => void;
};

export function ZoneGallery({
  zones,
  openId,
  current,
  answer,
  disabledReason,
  onOpen,
  onPick,
  onNext,
  onRest,
}: ZoneGalleryProps) {
  const open = zones.find((zone) => zone.id === openId);
  const openCount = (zone: CellZone) => zone.cells.filter((cell) => !answer(cell.object)).length;
  if (open === undefined) {
    return (
      <Zone title="Where the AI is unsure" sub="Open a zone to go through its unsure cells">
        <ul aria-label="Zones where the AI is unsure" className="m-0 grid list-none gap-1.5 p-0">
          {zones.map((zone) => (
            <li key={zone.id}>
              <button
                type="button"
                onClick={() => onOpen(zone.id)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-ctl border border-line bg-chrome px-3 py-2 text-left text-body-sm text-fg hover:bg-chrome-2"
              >
                <b className="font-semibold">
                  {zone.id.replace("zone-", "Zone ")} · {zone.name}
                </b>
                <span className="flex-1 text-fg-dim">
                  {zone.cells.length} unsure cells, {openCount(zone)} open
                </span>
                <Icon name="down" className="-rotate-90 text-fg-faint" />
              </button>
            </li>
          ))}
        </ul>
      </Zone>
    );
  }
  const remaining = openCount(open);
  return (
    <Zone
      title={`${open.id.replace("zone-", "Zone ")} · ${open.name}`}
      end={
        <Button variant="ghost" size="sm" onClick={() => onOpen(null)}>
          All zones
        </Button>
      }
    >
      <p className="m-0 text-body-sm text-fg-dim" aria-live="polite">
        {open.cells.length - remaining} of {open.cells.length} unsure cells decided
      </p>
      <fieldset
        aria-label={`Unsure cells in ${open.name}`}
        className="m-0 grid min-w-0 gap-1.5 border-0 p-0"
        style={{ gridTemplateColumns: "repeat(auto-fill, 40px)" }}
      >
        {open.cells.map((cell) => {
          const value = answer(cell.object)?.value;
          return (
            <GalleryTile
              key={cell.object}
              size={40}
              image={lookUrl("hpf")}
              objectId={cell.object}
              label={`${cell.class_name.toLowerCase()} cell`}
              state={cell.object === current ? "current" : value ? "done" : "to-check"}
              decision={value ?? "open"}
              ringed={!value}
              ai={{
                calls: [{ label: cell.class_name.toLowerCase(), probability: cell.score }],
                typer: reviewTyper,
                wording: "words",
              }}
              outline={<CellOutline object={cell.object} />}
              onClick={() => onPick(cell.object)}
              {...cropStyle(cell.object)}
            />
          );
        })}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={remaining === 0} onClick={onNext}>
          Next unsure cell <Keycap keys="J" size="sm" />
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={remaining === 0 || disabledReason !== undefined}
          title={disabledReason ?? "Keeps the AI call on every open unsure cell in this zone"}
          onClick={onRest}
        >
          Rest look right <Keycap keys="⇧K" size="sm" />
        </Button>
      </div>
    </Zone>
  );
}
