import { AnalysisCards, type AnalysisCardsProps } from "@parfocal/ui/components/analysis-cards";
import { Icon } from "@parfocal/ui/components/icon";
import {
  SidePanel,
  type SidePanelProps,
  type SidePanelTab,
} from "@parfocal/ui/components/side-panel";
import type { ViewerPartName } from "@parfocal/ui/lib/analysis-parts";
import {
  type InspectorCounts,
  type InspectorTabName,
  type InspectorTemplate,
  inspectorTabLabels,
  inspectorTabOrder,
  templateName,
} from "@parfocal/ui/lib/inspector-tabs";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type TemplateLineProps = React.ComponentProps<"div"> & {
  template: InspectorTemplate;
};

function TemplateLine({ template, className, ...props }: TemplateLineProps) {
  return (
    <div
      data-slot="template-line"
      data-template={template}
      className={cn(
        "flex items-center gap-2 border-b border-line px-(--density-panel-pad) py-1.5 text-caption text-fg-dim",
        className,
      )}
      {...props}
    >
      <Icon name="layers" />
      {template === "none" ? (
        <span>{templateName(template)}</span>
      ) : (
        <>
          <span>Analysis template</span>
          <b className="truncate font-semibold text-fg">{templateName(template)}</b>
        </>
      )}
    </div>
  );
}

type InspectorBody = {
  body: React.ReactNode;
  foot?: React.ReactNode;
};

type InspectorPanelProps = Omit<SidePanelProps, "tabs" | "head" | "defaultTab"> & {
  template: InspectorTemplate;
  parts: readonly ViewerPartName[];
  counts: InspectorCounts;
  bodies: Record<InspectorTabName, InspectorBody>;
  staging?: Omit<AnalysisCardsProps, "parts"> | undefined;
  defaultTab?: InspectorTabName;
};

function inspectorTabs(
  counts: InspectorCounts,
  bodies: Record<InspectorTabName, InspectorBody>,
): SidePanelTab[] {
  return inspectorTabOrder.map((name) => ({
    value: name,
    label: inspectorTabLabels[name],
    count: counts[name],
    body: bodies[name].body,
    ...(bodies[name].foot ? { foot: bodies[name].foot } : {}),
  }));
}

function InspectorPanel({
  template,
  parts,
  counts,
  bodies,
  staging,
  ...props
}: InspectorPanelProps) {
  return (
    <SidePanel
      dense
      {...props}
      tabs={inspectorTabs(counts, bodies)}
      head={
        <>
          <TemplateLine template={template} />
          {staging ? <AnalysisCards parts={parts} {...staging} /> : null}
        </>
      }
    />
  );
}

export {
  type InspectorBody,
  InspectorPanel,
  type InspectorPanelProps,
  inspectorTabs,
  TemplateLine,
};
