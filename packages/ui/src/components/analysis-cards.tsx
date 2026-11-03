import { InspectorCard, RegionRow, StagingHero } from "@parfocal/ui/components/inspector";
import {
  aiSizeError,
  macroMm,
  microMm,
  type StagingArea,
  type StagingCategory,
  scaleMax,
  scaleMin,
  showsStaging,
  stagingCategory,
  type ViewerPartName,
} from "@parfocal/ui/lib/analysis-parts";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

const categoryIfConfirmed: Record<StagingCategory, string> = {
  macro: "Macro if confirmed",
  micro: "Micro if confirmed",
  ITC: "ITC if confirmed",
};

const formatMm = (mm: number) => `${mm.toFixed(1)} mm`;

const clampToScale = (mm: number) => Math.min(scaleMax, Math.max(scaleMin, mm));

type StagingCardsProps = React.ComponentProps<"section"> & {
  areas: StagingArea[];
  showList?: boolean;
};

function StagingCards({ areas, showList = true, className, ...props }: StagingCardsProps) {
  const ranked = [...areas].sort((left, right) => right.size - left.size);
  const lead = ranked[0];
  return (
    <section
      data-slot="staging-cards"
      aria-label="Staging"
      className={cn("grid gap-3 border-b border-line bg-chrome p-5", className)}
      {...props}
    >
      {lead ? (
        <StagingHero
          title={`Metastasis likely, largest about ${formatMm(lead.size)}`}
          category={categoryIfConfirmed[stagingCategory(lead.size)]}
          sub={`${ranked.length} ${ranked.length === 1 ? "area" : "areas"}, largest first. Start with ${lead.object}.`}
          range={{
            min: scaleMin,
            max: scaleMax,
            low: clampToScale(lead.size * (1 - aiSizeError)),
            high: clampToScale(lead.size * (1 + aiSizeError)),
            point: clampToScale(lead.size),
            cuts: [microMm, macroMm],
          }}
        />
      ) : (
        <p className="m-0 text-body-sm text-fg-dim">No tumor areas found on this slide.</p>
      )}
      {showList && ranked.length ? (
        <InspectorCard
          className="grid max-h-40 gap-1 overflow-auto"
          aria-label="Areas, largest first"
        >
          {ranked.map((area, index) => (
            <RegionRow
              key={area.object}
              objectId={area.object}
              kind="Tumor region"
              size={formatMm(area.size)}
              category={stagingCategory(area.size)}
              selected={index === 0}
            />
          ))}
        </InspectorCard>
      ) : null}
    </section>
  );
}

type AnalysisCardsProps = {
  parts: readonly ViewerPartName[];
  areas: StagingArea[];
};

function AnalysisCards({ parts, areas }: AnalysisCardsProps) {
  if (!showsStaging(parts)) return null;
  return <StagingCards areas={areas} showList={parts.includes("area-list")} />;
}

export { AnalysisCards, type AnalysisCardsProps, StagingCards, type StagingCardsProps };
