import type { ReviewObject, SlideResultStats } from "@parfocal/api-client";
import { Person, type PersonInfo } from "@parfocal/ui/components/person";
import {
  SetChip,
  SwipeHandle,
  VizKey,
  VizLegend,
  VizRamp,
} from "@parfocal/ui/components/visualize";
import type { ReactNode } from "react";
import type { Confidence } from "../review/decision-style.ts";
import { overviewSize, regionShapes } from "../review/slide-geometry.ts";
import { type Camera, type RegionStyle, type SlideTag, shapeKey } from "../review/slide-still.tsx";
import { lookUrl } from "../thumbnails.ts";
import type { LayerView } from "./viewer-scenes.ts";

export const setColours = { a: "#f87171", b: "#a3e635", reviewed: "#38bdf8" } as const;

const agreementColours = {
  both: "#4ade80",
  ai_only: "#f59e0b",
  reviewer_only: "#38bdf8",
} as const;

const readerColours = { same: "#4ade80", split: "#f59e0b", unsure: "#f472b6" } as const;

const heatCutoff = 0.6;

export type LayerInput = {
  view: LayerView;
  objects: ReviewObject[];
  added: string[];
  stats: SlideResultStats | undefined;
  confidence: Confidence;
  setA: string;
  setB: string;
  reviewers: PersonInfo[];
  selected: string | null;
  otherSets?: { id: string; color: string }[];
  reviewedOn?: boolean;
};

export type LayerDrawing = {
  regionStyle: (object: string) => RegionStyle | undefined;
  tags: SlideTag[];
  underlay:
    | ((state: { camera: Camera; size: { width: number; height: number } }) => ReactNode)
    | undefined;
  legend: ReactNode;
  extra: ReactNode;
};

const centreOf = (key: string) => {
  const box = regionShapes[key]?.box ?? [0, 0, 0, 0];
  return { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, width: box[2] - box[0] };
};

const sureText = (score: number, confidence: Confidence) =>
  confidence === "number" ? ` ${Math.round(score * 100)}%` : "";

const heatImage = (opacity: number) => (
  <image
    href={lookUrl("heat")}
    width={overviewSize.width}
    height={overviewSize.height}
    opacity={opacity}
  />
);

const scaled = (key: string, factor: number, props: Record<string, string | number>) => {
  const shape = regionShapes[key];
  if (shape === undefined) return null;
  const { x, y } = centreOf(key);
  return (
    <path
      key={`${key}-b`}
      d={shape.path}
      transform={`translate(${x},${y}) scale(${factor}) translate(${-x},${-y})`}
      vectorEffect="non-scaling-stroke"
      strokeWidth={2.4}
      {...props}
    />
  );
};

export function layerDrawing(input: LayerInput): LayerDrawing {
  const { view, objects, added, stats, confidence, selected } = input;
  const reviewedOn = input.reviewedOn ?? true;
  const otherSets = input.otherSets ?? [];
  const regions = objects.filter((item) => item.kind === "region");
  const score = (object: string) => regions.find((item) => item.object === object)?.score;
  const ids = [...regions.map((item) => item.object), ...added];
  const tagsIn = (colour: (object: string) => string, withScore = false) =>
    ids.map((object) => {
      const value = score(object);
      return {
        object,
        text: `${object}${withScore && value !== undefined ? sureText(value, confidence) : ""}`,
        color: colour(object),
      };
    });
  const plain = (object: string) => (added.includes(object) ? setColours.reviewed : setColours.a);
  const nothing: LayerDrawing = {
    regionStyle: (object) =>
      added.includes(object)
        ? reviewedOn
          ? { stroke: setColours.reviewed, dash: "6 4" }
          : { stroke: "none" }
        : undefined,
    tags: tagsIn(plain, true).filter((tag) => reviewedOn || !added.includes(tag.object)),
    underlay: otherSets.length
      ? () => (
          <g data-slot="other-set-outlines">
            {otherSets.map(({ id, color }, set) => (
              <g key={id}>
                {regions.map((item, index) =>
                  scaled(shapeKey(item.object), 1.04 + 0.03 * ((index + set) % 3), {
                    fill: "none",
                    stroke: color,
                    strokeDasharray: "8 5",
                    strokeWidth: 1.6,
                    opacity: 0.85,
                  }),
                )}
              </g>
            ))}
          </g>
        )
      : undefined,
    legend: null,
    extra: null,
  };
  if (view === "heat") {
    const faded = regions.filter((item) => item.score < heatCutoff).map((item) => item.object);
    return {
      regionStyle: (object) =>
        faded.includes(object) || added.includes(object)
          ? { stroke: "none" }
          : { stroke: "#ffffff", dash: "6 4", width: 1.6 },
      tags: [],
      underlay: () => heatImage(0.75),
      legend: (
        <VizLegend
          kind="Heatmap"
          title="Tumor probability"
          note={`Regions ${faded.join(" and ")} fade out above ${heatCutoff.toFixed(2)}.`}
        >
          <VizRamp ramp="heat" labels={["0", "0.5", "1"]} />
          <span className="flex items-center justify-between gap-3 text-fg-dim">
            Show from
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-chrome-2">
              <i className="block h-full w-[60%] bg-accent-fill" />
            </span>
            <b className="font-mono font-semibold text-fg">{heatCutoff.toFixed(2)}</b>
          </span>
        </VizLegend>
      ),
      extra: null,
    };
  }
  if (view === "density") {
    return {
      regionStyle: () => ({ stroke: "none" }),
      tags: tagsIn(() => "#facc15"),
      underlay: () => (
        <>
          <defs>
            <radialGradient id="density-glow">
              <stop offset="0" stopColor="#facc15" stopOpacity="0.85" />
              <stop offset="0.5" stopColor="#f97316" stopOpacity="0.45" />
              <stop offset="1" stopColor="#7c3aed" stopOpacity="0" />
            </radialGradient>
          </defs>
          {Object.keys(regionShapes).map((key) => {
            const { x, y, width } = centreOf(key);
            return (
              <circle
                key={key}
                cx={x}
                cy={y}
                r={Math.max(60, width * 0.7)}
                fill="url(#density-glow)"
              />
            );
          })}
        </>
      ),
      legend: (
        <VizLegend kind="Density" title="Cells per 0.1 mm²">
          <VizRamp ramp="density" labels={["0", "400", "800+"]} />
        </VizLegend>
      ),
      extra: null,
    };
  }
  if (view === "diff") {
    const agreement = new Map(
      (stats?.ai_vs_reviewed.objects ?? []).map((row) => [row.object, row.agreement]),
    );
    const colour = (object: string) => agreementColours[agreement.get(object) ?? "both"];
    const count = (kind: keyof typeof agreementColours) =>
      [...agreement.values()].filter((value) => value === kind).length;
    return {
      regionStyle: (object) => ({
        stroke: colour(object),
        fill: `${colour(object)}22`,
        width: 2.4,
      }),
      tags: tagsIn(colour),
      underlay: undefined,
      legend: (
        <VizLegend
          kind="AI vs reviewed"
          title={`${input.setA} and Reviewed`}
          note={
            stats
              ? `Region Dice ${stats.ai_vs_reviewed.dice.toFixed(2)} · cells agree ${stats.ai_vs_reviewed.cells_agree_percent}%`
              : undefined
          }
        >
          <VizKey
            color={agreementColours.both}
            label="AI and reviewer agree"
            count={count("both")}
          />
          <VizKey
            color={agreementColours.ai_only}
            label="AI only, reviewer disagreed"
            count={count("ai_only")}
          />
          <VizKey
            color={agreementColours.reviewer_only}
            label={`Reviewer only, added ${added.join(", ")}`}
            count={count("reviewer_only")}
          />
        </VizLegend>
      ),
      extra: null,
    };
  }
  if (view === "models") {
    const onlyA = stats?.model_vs_model.only_in_a ?? [];
    const inBoth = regions
      .filter((item) => !onlyA.includes(item.object))
      .map((item) => item.object);
    return {
      regionStyle: (object) =>
        added.includes(object) ? { stroke: "none" } : { stroke: setColours.a, width: 2.4 },
      tags: tagsIn(() => setColours.a).filter((tag) => !added.includes(tag.object)),
      underlay: () => (
        <>
          {inBoth.map((object, index) =>
            scaled(shapeKey(object), index === 1 ? 1.15 : 1.05, {
              fill: "none",
              stroke: setColours.b,
              strokeDasharray: "8 5",
            }),
          )}
        </>
      ),
      legend: (
        <VizLegend
          kind="Model vs model"
          title="Two result sets"
          note={`Matched by overlap. ${inBoth[0]} to ${inBoth.at(-1)} are in both, ${onlyA.join(", ")} only in A.${stats ? ` Dice ${stats.model_vs_model.dice.toFixed(2)}.` : ""}`}
        >
          <VizKey color={setColours.a} label={`A · ${input.setA}`} />
          <VizKey color={setColours.b} label={`B · ${input.setB}`} />
        </VizLegend>
      ),
      extra: null,
    };
  }
  if (view === "readers") {
    const agreement = new Map(
      (stats?.reviewers.objects ?? []).map((row) => [row.object, row.agreement]),
    );
    const colour = (object: string) => readerColours[agreement.get(object) ?? "same"];
    const count = (kind: keyof typeof readerColours) =>
      [...agreement.values()].filter((value) => value === kind).length;
    return {
      regionStyle: (object) => ({ stroke: colour(object), width: 2.4 }),
      tags: tagsIn(colour),
      underlay: undefined,
      legend: (
        <VizLegend
          kind="Reviewer vs reviewer"
          title="Two reviewers"
          note={
            stats?.reviewers.kappa === null || stats === undefined
              ? "Shown only after both submitted."
              : `Cohen's kappa ${stats.reviewers.kappa.toFixed(2)} on regions. Shown only after both submitted.`
          }
        >
          <div className="grid gap-1.5">
            {input.reviewers.map((person) => (
              <Person key={person.initials} person={person} size={20} />
            ))}
          </div>
          <VizKey color={readerColours.same} label="Same decision" count={count("same")} />
          <VizKey
            color={readerColours.split}
            label="One agrees, one disagrees"
            count={count("split")}
          />
          <VizKey color={readerColours.unsure} label="One unsure" count={count("unsure")} />
        </VizLegend>
      ),
      extra: null,
    };
  }
  if (view === "swipe") {
    return {
      regionStyle: (object) =>
        added.includes(object) ? { stroke: "none" } : { stroke: setColours.a, width: 2.4 },
      tags: tagsIn(() => setColours.a).filter((tag) => !added.includes(tag.object)),
      underlay: ({ camera, size }) => {
        const splitX = camera.x + (size.width * 0.52 - size.width / 2) / camera.scale;
        return (
          <>
            {heatImage(0.3)}
            <defs>
              <clipPath id="swipe-right">
                <rect x={splitX} y={0} width={overviewSize.width} height={overviewSize.height} />
              </clipPath>
            </defs>
            <g clipPath="url(#swipe-right)">
              {regions.map((item) =>
                scaled(shapeKey(item.object), 1.08, {
                  fill: `${setColours.b}2e`,
                  stroke: setColours.b,
                }),
              )}
            </g>
          </>
        );
      },
      legend: null,
      extra: (
        <>
          <SetChip color={setColours.a} className="absolute top-4 left-4">
            A · {input.setA}
          </SetChip>
          <SetChip color={setColours.b} className="absolute top-4 right-4">
            B · {input.setB}
          </SetChip>
          <SwipeHandle style={{ left: "52%" }} />
        </>
      ),
    };
  }
  if (view === "table") {
    return {
      regionStyle: (object) =>
        added.includes(object)
          ? { stroke: setColours.reviewed, dash: "6 4" }
          : object === selected
            ? { stroke: "#ffffff", width: 4 }
            : { stroke: setColours.a, width: 2.4 },
      tags: tagsIn((object) => (object === selected ? "#ffffff" : plain(object))),
      underlay: () => heatImage(0.3),
      legend: null,
      extra: null,
    };
  }
  return nothing;
}
