import type { Decision } from "@parfocal/tokens";
import { AreaCallButtons } from "@parfocal/ui/components/area-call";
import { Button } from "@parfocal/ui/components/button";
import { GalleryTile } from "@parfocal/ui/components/gallery-tile";
import { Icon } from "@parfocal/ui/components/icon";
import {
  AiCallLine,
  BackLink,
  CellCrop,
  CountBar,
  NumberLine,
  RangeBar,
  StepBlock,
} from "@parfocal/ui/components/inspector";
import { ModelWarningsBlock } from "@parfocal/ui/components/model-warnings";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import { FoldingZone, Hint, Zone, Zones } from "@parfocal/ui/components/zone";
import { cellLine } from "@parfocal/ui/lib/ai-state";
import { macroMm, microMm, scaleMax, scaleMin } from "@parfocal/ui/lib/analysis-parts";
import { type AreaCall, areaRole, roleText } from "@parfocal/ui/lib/area-call";
import type { TypeCall, TyperEvidence, WordingSetting } from "@parfocal/ui/lib/confidence-words";
import {
  backLabel,
  CHANGED_ZONE_ID,
  CHANGED_ZONE_NAME,
  type FindingsSection,
  type FindingsSelection,
  type FindingsZone,
  findingsSections,
  formatAreaMm,
  nextStagingStep,
  type StagingPanelArea,
  type StagingStep,
  stagingSteps,
  stepBack,
  zoneNumbers,
  zonesMostUnsureFirst,
} from "@parfocal/ui/lib/findings-layout";
import type { ModelWarning } from "@parfocal/ui/lib/model-warnings";
import type { NumberLineClass } from "@parfocal/ui/lib/number-line";
import type { TumorShareResult } from "@parfocal/ui/lib/tumor-share";
import type * as React from "react";

type FindingsCell = {
  id: string;
  label: string;
  decision?: Decision;
  imagePosition?: string;
  imageSize?: string;
};

type FindingsNumbers = {
  classes: readonly NumberLineClass[];
  result?: TumorShareResult | null;
};

type FindingsPanelZone = FindingsZone & FindingsNumbers & { tiles: readonly FindingsCell[] };

type FindingsOutline = FindingsNumbers & { id: string; name: string };

type FindingsCellCall = {
  calls: readonly TypeCall[];
  typer: TyperEvidence;
  wording: WordingSetting;
};

type FindingsExtra = {
  id: string;
  title: string;
  summary: string;
  body: React.ReactNode;
};

type FindingsHover = { id: string; numbers: string };

type CellFindingsProps = {
  image: string;
  slide: FindingsNumbers & { label: string };
  selection: FindingsSelection;
  onSelect: (selection: FindingsSelection) => void;
  zones: readonly FindingsPanelZone[];
  scattered?: readonly FindingsCell[];
  outline?: FindingsOutline | undefined;
  changed?: FindingsPanelZone | undefined;
  onUndoChanged?: (() => void) | undefined;
  cellCall?: FindingsCellCall | undefined;
  extras?: readonly FindingsExtra[];
  hovered?: FindingsHover | undefined;
  warnings?: readonly ModelWarning[];
};

type NodeStagingProps = {
  areas: readonly StagingPanelArea[];
  current: string | null;
  onPickArea: (id: string) => void;
  onCall: (id: string, call: AreaCall) => void;
  onMeasure: (id: string) => void;
  onCount: (id: string) => void;
  warnings?: readonly ModelWarning[];
};

type FindingsPanelProps =
  | ({ layout: "cell-findings" } & CellFindingsProps)
  | ({ layout: "node-staging" } & NodeStagingProps);

const zoneLabel = (zone: FindingsZone) =>
  zone.id === CHANGED_ZONE_ID
    ? CHANGED_ZONE_NAME
    : `${zone.id.replace("zone-", "Zone ")} · ${zone.name}`;

const hatch =
  "size-3 shrink-0 rounded-[3px] border-[1.5px] border-dashed border-unsure bg-[repeating-linear-gradient(-45deg,var(--unsure)_0_2px,transparent_2px_5px)]";

const rowClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-ctl border border-line bg-chrome px-3 py-2 text-left text-body-sm text-fg outline-none hover:bg-chrome-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

function ZoneButton({ zone, onOpen }: { zone: FindingsZone; onOpen: () => void }) {
  return (
    <button type="button" data-slot="findings-zone-row" onClick={onOpen} className={rowClass}>
      <span aria-hidden="true" className={hatch} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <b className="truncate font-semibold">{zoneLabel(zone)}</b>
        <span className="truncate text-caption text-fg-dim">{zoneNumbers(zone)}</span>
      </span>
      <Icon name="down" className="-rotate-90 text-fg-faint" />
    </button>
  );
}

type TilesProps = {
  label: string;
  image: string;
  cells: readonly FindingsCell[];
  current?: string | undefined;
  onPick: (cell: FindingsCell) => void;
};

function Tiles({ label, image, cells, current, onPick }: TilesProps) {
  return (
    <fieldset
      aria-label={label}
      className="m-0 grid min-w-0 gap-1.5 border-0 p-0"
      style={{ gridTemplateColumns: "repeat(auto-fill, 40px)" }}
    >
      {cells.map((cell) => (
        <GalleryTile
          key={cell.id}
          size={40}
          image={image}
          objectId={cell.id}
          label={cell.label}
          state={cell.id === current ? "current" : cell.decision ? "done" : "to-check"}
          decision={cell.decision ?? "open"}
          ringed={!cell.decision}
          imagePosition={cell.imagePosition}
          imageSize={cell.imageSize}
          onClick={() => onPick(cell)}
        />
      ))}
    </fieldset>
  );
}

function NumbersZone({ title, numbers }: { title: string; numbers: FindingsNumbers }) {
  return (
    <Zone data-slot="findings-number-line" title={title}>
      <NumberLine classes={numbers.classes} result={numbers.result ?? null} />
    </Zone>
  );
}

function Warnings({ warnings }: { warnings: readonly ModelWarning[] }) {
  return <ModelWarningsBlock warnings={warnings} />;
}

function CellFindings({
  image,
  slide,
  selection,
  onSelect,
  zones,
  scattered = [],
  outline,
  changed,
  onUndoChanged,
  cellCall,
  extras = [],
  hovered,
  warnings = [],
}: CellFindingsProps) {
  const ordered = zonesMostUnsureFirst(zones);
  const everyZone = changed ? [...ordered, changed] : ordered;
  const zoneOf = (id: string | null) => everyZone.find((zone) => zone.id === id);
  const openZone =
    selection.kind === "zone"
      ? zoneOf(selection.id)
      : selection.kind === "cell"
        ? zoneOf(selection.zoneId)
        : undefined;
  const cell =
    selection.kind === "cell"
      ? [...(openZone?.tiles ?? []), ...scattered].find((item) => item.id === selection.id)
      : undefined;
  const back = stepBack(selection);
  const sections = findingsSections(selection, {
    warnings: warnings.length,
    zones: ordered.length,
    scattered: scattered.length,
    outline: outline !== undefined,
    changed: changed?.tiles.length ?? 0,
    extras: extras.length,
  });
  const numbers =
    selection.kind === "zone" && openZone
      ? { title: zoneLabel(openZone), numbers: openZone }
      : selection.kind === "outline" && outline
        ? { title: `${outline.id} · ${outline.name}`, numbers: outline }
        : { title: slide.label, numbers: slide };
  const pickIn = (zoneId: string | null) => (picked: FindingsCell) =>
    onSelect({ kind: "cell", id: picked.id, zoneId });

  const render: Record<FindingsSection, () => React.ReactNode> = {
    warnings: () => <Warnings key="warnings" warnings={warnings} />,
    back: () => (
      <BackLink key="back" onClick={() => onSelect(back)}>
        {backLabel(selection, openZone ? zoneLabel(openZone) : undefined)}
      </BackLink>
    ),
    "number-line": () => <NumbersZone key="number-line" {...numbers} />,
    zones: () => (
      <Zone
        key="zones"
        data-slot="findings-zones"
        title="Where the AI is unsure"
        sub="Most unsure first. Open a zone to go through its cells."
      >
        <ul aria-label="Zones where the AI is unsure" className="m-0 grid list-none gap-1.5 p-0">
          {ordered.map((zone) => (
            <li key={zone.id}>
              <ZoneButton zone={zone} onOpen={() => onSelect({ kind: "zone", id: zone.id })} />
            </li>
          ))}
        </ul>
      </Zone>
    ),
    scattered: () => (
      <Zone
        key="scattered"
        data-slot="findings-scattered"
        title="Scattered unsure cells"
        sub={`${scattered.length} outside every zone`}
      >
        <Tiles
          label="Scattered unsure cells"
          image={image}
          cells={scattered}
          onPick={pickIn(null)}
        />
      </Zone>
    ),
    outline: () =>
      outline ? (
        <Zone key="outline" data-slot="findings-outline" title="Your outline">
          <button
            type="button"
            className={rowClass}
            onClick={() => onSelect({ kind: "outline", id: outline.id })}
          >
            <ObjectIdTag>{outline.id}</ObjectIdTag>
            <span className="min-w-0 flex-1 truncate">{outline.name}</span>
            <Icon name="down" className="-rotate-90 text-fg-faint" />
          </button>
        </Zone>
      ) : null,
    changed: () =>
      changed ? (
        <Zone
          key="changed"
          data-slot="findings-changed"
          title={CHANGED_ZONE_NAME}
          sub="The AI re-checked this slide after your corrections. Learning stays on this slide."
          end={
            onUndoChanged ? (
              <Button variant="ghost" size="sm" onClick={onUndoChanged}>
                Undo
              </Button>
            ) : null
          }
        >
          <ZoneButton
            zone={changed}
            onOpen={() => onSelect({ kind: "zone", id: CHANGED_ZONE_ID })}
          />
        </Zone>
      ) : null,
    gallery: () =>
      openZone ? (
        <Zone
          key="gallery"
          data-slot="findings-gallery"
          title={openZone.id === CHANGED_ZONE_ID ? "Changed cells" : "Unsure cells"}
          sub={zoneNumbers(openZone)}
        >
          <Tiles
            label={`Cells in ${zoneLabel(openZone)}`}
            image={image}
            cells={openZone.tiles}
            onPick={pickIn(openZone.id)}
          />
        </Zone>
      ) : null,
    cell: () =>
      selection.kind === "cell" ? (
        <Zone key="cell" data-slot="findings-cell" title={`Cell ${selection.id}`}>
          <div className="flex items-start gap-3">
            <CellCrop image={image} objectId={selection.id} />
            <div className="grid min-w-0 flex-1 gap-1.5">
              {cellCall ? <AiCallLine {...cellCall} /> : null}
              {cell?.decision ? (
                <span className="text-caption text-fg-dim">Checked by you</span>
              ) : null}
            </div>
          </div>
          <Hint>Pick the type in the bar next to the cell on the slide.</Hint>
        </Zone>
      ) : null,
    siblings: () =>
      openZone && selection.kind === "cell" ? (
        <Zone key="siblings" data-slot="findings-siblings" title={zoneLabel(openZone)}>
          <Tiles
            label={`Cells in ${zoneLabel(openZone)}`}
            image={image}
            cells={openZone.tiles}
            current={selection.id}
            onPick={pickIn(openZone.id)}
          />
        </Zone>
      ) : null,
    extras: () => (
      <div key="extras" data-slot="findings-extras" className="grid gap-(--space-in)">
        {extras.map((extra) => (
          <FoldingZone key={extra.id} title={extra.title} summary={extra.summary}>
            {extra.body}
          </FoldingZone>
        ))}
      </div>
    ),
  };

  return (
    <>
      {sections.map((section) => render[section]())}
      {hovered ? (
        <p
          data-slot="findings-hover"
          aria-live="polite"
          className="m-0 flex items-center gap-2 rounded-ctl border border-line bg-chrome-2 px-3 py-2 text-caption text-fg-dim"
        >
          <ObjectIdTag>{hovered.id}</ObjectIdTag>
          <span className="min-w-0 flex-1">{hovered.numbers}</span>
        </p>
      ) : null}
    </>
  );
}

type AreaStepsProps = {
  area: StagingPanelArea;
  number: number;
  onCall: (call: AreaCall) => void;
  onMeasure: () => void;
  onCount: () => void;
};

function AreaSteps({ area, number, onCall, onMeasure, onCount }: AreaStepsProps) {
  const next = nextStagingStep(area);
  const later = (step: StagingStep) =>
    step.name === next ? null : <Hint>Opens after step {step.index - 1}.</Hint>;
  const bodies: Record<StagingStep["name"], (step: StagingStep) => React.ReactNode> = {
    tumor: () => <AreaCallButtons area={`area ${number}`} value={area.call} onCall={onCall} />,
    size: (step) =>
      later(step) ?? (
        <>
          <span className="text-body-sm text-fg-dim">
            The AI sizes it at {formatAreaMm(area.size)}, between {formatAreaMm(area.low)} and{" "}
            {formatAreaMm(area.high)}. Measure across the widest part.
          </span>
          <Button size="sm" onClick={onMeasure}>
            Measure it
          </Button>
        </>
      ),
    count: (step) =>
      later(step) ?? (
        <>
          {area.cells ? (
            <>
              <span className="text-body-sm text-fg-dim">
                The AI counts {area.cells.low} to {area.cells.high} tumor cells. The line is{" "}
                {cellLine}.
              </span>
              <CountBar count={Math.round((area.cells.low + area.cells.high) / 2)} />
            </>
          ) : null}
          <Button size="sm" onClick={onCount}>
            Count the tumor cells
          </Button>
        </>
      ),
  };
  return (
    <ol aria-label={`Steps for area ${number}`} className="m-0 grid list-none gap-2 p-0">
      {stagingSteps(area).map((step) => (
        <li key={step.name}>
          <StepBlock
            index={step.index}
            title={step.title}
            done={step.done}
            answer={step.answer}
            data-step={step.name}
          >
            {bodies[step.name](step)}
          </StepBlock>
        </li>
      ))}
    </ol>
  );
}

function NodeStaging({
  areas,
  current,
  onPickArea,
  onCall,
  onMeasure,
  onCount,
  warnings = [],
}: NodeStagingProps) {
  const largestFirst = [...areas].sort((a, b) => (b.measured ?? b.size) - (a.measured ?? a.size));
  const callable = largestFirst.map((area) => ({ id: area.id, call: area.call }));
  return (
    <>
      {warnings.length > 0 ? <Warnings warnings={warnings} /> : null}
      {areas.length === 0 ? (
        <Zone title="Areas">
          <Hint>The AI found no tumor area on this slide.</Hint>
        </Zone>
      ) : null}
      {largestFirst.map((area, position) => {
        const role = areaRole(callable, area.id);
        const open = area.id === current;
        const shown = area.measured ?? area.size;
        return (
          <Zone
            key={area.id}
            data-slot="findings-area"
            data-role={role}
            aria-label={`Area ${position + 1}`}
            highlight={open}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => onPickArea(area.id)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-ctl border-0 bg-transparent p-0 text-left text-fg outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-center gap-2 text-body font-semibold">
                  Area {position + 1}
                  <ObjectIdTag>{area.id}</ObjectIdTag>
                  <span className="font-normal text-fg-dim">{formatAreaMm(shown)}</span>
                </span>
                <span data-slot="findings-area-role" className="text-caption text-fg-dim">
                  {roleText[role]}
                </span>
              </span>
              <Icon name="down" className={open ? "text-fg-dim" : "-rotate-90 text-fg-faint"} />
            </button>
            {open ? (
              <>
                <RangeBar
                  min={scaleMin}
                  max={scaleMax}
                  low={area.measured ?? area.low}
                  high={area.measured ?? area.high}
                  point={shown}
                  cuts={[microMm, macroMm]}
                />
                <AreaSteps
                  area={area}
                  number={position + 1}
                  onCall={(call) => onCall(area.id, call)}
                  onMeasure={() => onMeasure(area.id)}
                  onCount={() => onCount(area.id)}
                />
              </>
            ) : null}
          </Zone>
        );
      })}
    </>
  );
}

function FindingsPanel(props: FindingsPanelProps) {
  return (
    <Zones data-slot="findings-panel" data-layout={props.layout}>
      {props.layout === "node-staging" ? <NodeStaging {...props} /> : <CellFindings {...props} />}
    </Zones>
  );
}

export {
  type CellFindingsProps,
  type FindingsCell,
  type FindingsCellCall,
  type FindingsExtra,
  type FindingsHover,
  type FindingsOutline,
  FindingsPanel,
  type FindingsPanelProps,
  type FindingsPanelZone,
  type NodeStagingProps,
};
