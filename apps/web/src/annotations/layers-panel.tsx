import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectClass } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { LayerList, type LayerRow as ListRow } from "@parfocal/ui/components/viewer-tools";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import type { SlideAreaEntry } from "../viewer/slide-areas.ts";
import { type AnnotationDocument, removeGroup, updateGroup } from "./document.ts";
import {
  addLayer,
  bucketsOf,
  deleteGroupWithShapes,
  groupBy,
  type LayerContext,
  type LayerLens,
  layerLenses,
  layerRows,
  moveToGroup,
  overlaysHidden,
  renameGroup,
  rgbOfHex,
  setOverlaysHidden,
  toggleHidden,
  toggleLocked,
  ungroupedKey,
  usableTarget,
} from "./layers.ts";
import type { GroupId, ShapeId } from "./shapes.ts";
import type { SkippedTarget } from "./use-saved-annotations.ts";

type LayersPanelProps = {
  document: AnnotationDocument;
  onApply: (next: AnnotationDocument, label: string) => void;
  classes: readonly ProjectClass[];
  areas: readonly SlideAreaEntry[];
  target: GroupId | null;
  onTarget: (id: GroupId | null) => void;
  selected?: readonly ShapeId[];
  skipped?: SkippedTarget | null;
  resultSets?: ReactNode;
};

const lensWords: Record<LayerLens, string> = {
  class: "class",
  cluster: "cluster",
  region: "region",
  source: "source",
};

const groupIdOf = (key: string): GroupId | null => {
  const id = Number(key);
  return Number.isInteger(id) ? id : null;
};

export function LayersPanel({
  document: doc,
  onApply,
  classes,
  areas,
  target,
  onTarget,
  selected = [],
  skipped = null,
  resultSets,
}: LayersPanelProps) {
  const { t } = useLingui();
  const [lens, setLens] = useState<LayerLens | null>(null);
  const context = useMemo<LayerContext>(
    () => ({
      classes: classes.map((item) => ({ id: item.id, name: item.name, colour: item.colour })),
      regions: areas.map((area) => ({
        name: area.object,
        extent: [
          area.bounds.x,
          area.bounds.y,
          area.bounds.x + area.bounds.width,
          area.bounds.y + area.bounds.height,
        ],
      })),
    }),
    [classes, areas],
  );
  const rows = useMemo(() => layerRows(doc, context), [doc, context]);
  const effective = usableTarget(doc, target);
  const goesTo = effective === null ? null : doc.groups.get(effective);
  const off = overlaysHidden(doc);
  const loose = useMemo(
    () => (lens === null ? 0 : bucketsOf(doc, lens, context).reduce((n, b) => n + b.ids.length, 0)),
    [doc, lens, context],
  );

  const toggleOverlays = useCallback(
    () => onApply(setOverlaysHidden(doc, !overlaysHidden(doc)), "Toggle overlays"),
    [doc, onApply],
  );
  const bindings = useBindings(["viewer"], ["overlays"]);
  useHotkeys(
    bindings,
    useCallback(
      ({ phase }: { phase: string }) => {
        if (phase === "press") toggleOverlays();
      },
      [toggleOverlays],
    ),
  );

  const listRows: ListRow[] = rows.map((row) => ({
    key: row.key,
    name: row.name,
    colour: row.colour,
    hex: row.hex,
    count: row.count,
    depth: row.depth,
    locked: row.locked,
    hasChildren: row.hasChildren,
    inheritedOff: row.hiddenAbove,
    plain: row.groupId === null,
    target: row.groupId !== null && row.groupId === effective,
  }));
  const hiddenKeys = rows.filter((row) => row.hidden).map((row) => row.key);

  const change = (key: string, edit: (id: GroupId) => AnnotationDocument, label: string) => {
    const id = groupIdOf(key);
    if (id !== null && key !== ungroupedKey) onApply(edit(id), label);
  };

  return (
    <section
      aria-label={t`Layers`}
      data-testid="layers-panel"
      data-overlays={off ? "hidden" : "shown"}
      data-target={effective ?? ""}
      className="grid max-h-[46vh] gap-2 overflow-auto rounded-ctl border border-line bg-chrome p-2"
    >
      {resultSets ? (
        <div data-testid="layers-result-sets" className="grid gap-1.5">
          {resultSets}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-1">
        <h2 className="m-0 text-body-sm font-semibold">
          <Trans>Layers</Trans>
        </h2>
        <span className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t`Add a layer`}
            title={t`Add a layer`}
            onClick={() => onApply(addLayer(doc, effective).document, "Add layer")}
          >
            <Icon name="plus" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={selected.length === 0}
                  data-testid="layers-move"
                  title={t`Move the selected shapes into a layer`}
                >
                  <Trans>Move to</Trans>
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-48">
              {rows.map((row) => (
                <DropdownMenuItem
                  key={row.key}
                  onClick={() => onApply(moveToGroup(doc, selected, row.groupId), "Move to layer")}
                >
                  {row.name}
                </DropdownMenuItem>
              ))}
              {rows.some((row) => row.groupId === null) ? null : (
                <DropdownMenuItem
                  onClick={() => onApply(moveToGroup(doc, selected, null), "Move to layer")}
                >
                  <Trans>Ungrouped</Trans>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={off ? t`Show overlays` : t`Hide overlays`}
            aria-pressed={off}
            title={off ? t`Show overlays (A)` : t`Hide overlays (A)`}
            data-testid="layers-overlays"
            onClick={toggleOverlays}
          >
            <Icon name={off ? "eye-off" : "eye"} />
          </Button>
          <Keycap keys="⌘G" size="sm" />
        </span>
      </div>
      {skipped ? (
        <p role="status" data-testid="layers-skipped" className="m-0 text-body-sm text-warn">
          {skipped.reason === "locked"
            ? t`${skipped.name} is locked, so the new shape went to Ungrouped.`
            : t`${skipped.name} is hidden, so the new shape went to Ungrouped.`}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="m-0 text-body-sm text-fg-dim">
          <Trans>Nothing drawn yet. Select shapes and press ⌘G to group them.</Trans>
        </p>
      ) : (
        <LayerList
          rows={listRows}
          hidden={hiddenKeys}
          onToggle={(key) => change(key, (id) => toggleHidden(doc, id), "Show or hide layer")}
          onLock={(key) => change(key, (id) => toggleLocked(doc, id), "Lock or unlock layer")}
          onColour={(key, hex) => {
            const color = rgbOfHex(hex);
            if (color)
              change(key, (id) => updateGroup(doc, id, { color }).document, "Layer colour");
          }}
          onRename={(key, name) => change(key, (id) => renameGroup(doc, id, name), "Rename layer")}
          onUngroup={(key) => change(key, (id) => removeGroup(doc, id), "Ungroup layer")}
          onDelete={(key) =>
            change(key, (id) => deleteGroupWithShapes(doc, id), "Delete layer and its shapes")
          }
          onPick={(key) => {
            const id = groupIdOf(key);
            if (id !== null) onTarget(id === effective ? null : id);
          }}
        />
      )}
      <div className="grid gap-1">
        <span className="text-caption font-semibold text-fg-dim uppercase">
          <Trans>Group by</Trans>
        </span>
        <SegmentedControl
          aria-label={t`Group by`}
          fill
          value={lens ?? ""}
          onValueChange={(value) => {
            const next = layerLenses.find((item) => item === value);
            if (next === undefined) return;
            setLens(next);
            onApply(groupBy(doc, next, context), `Group by ${lensWords[next]}`);
          }}
          options={layerLenses.map((item) => ({ value: item, label: lensWords[item] }))}
        />
        {lens !== null && loose > 0 ? (
          <Button
            size="sm"
            data-testid="layers-regroup"
            onClick={() => onApply(groupBy(doc, lens, context), `Group by ${lensWords[lens]}`)}
          >
            {plural(loose, {
              one: `Group # loose shape by ${lensWords[lens]}`,
              other: `Group # loose shapes by ${lensWords[lens]}`,
            })}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-1">
        <span className="text-caption font-semibold text-fg-dim uppercase">
          <Trans>New shapes go to</Trans>
        </span>
        <div
          data-testid="layers-target"
          className="flex items-center justify-between gap-2 text-body-sm"
        >
          <span className="inline-flex items-center gap-2">
            <i
              aria-hidden="true"
              className="size-2.5 rounded-[3px]"
              style={{
                background:
                  rows.find((row) => row.groupId === effective)?.colour ?? "var(--fg-faint)",
              }}
            />
            {goesTo?.name ?? t`Ungrouped`}
          </span>
          {target !== null && effective === null ? (
            <span className="text-fg-dim">{t`that layer is hidden or locked`}</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
