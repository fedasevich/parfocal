import { useLingui } from "@lingui/react/macro";
import { SidePanel } from "@parfocal/ui/components/side-panel";
import { useCallback, useState } from "react";
import { InspectorDock } from "../screens/review/inspector-dock.tsx";
import type { InspectorLayout, InspectorLayoutChange } from "../screens/review/inspector-layout.ts";
import type { InspectorSection } from "./inspector-slots.tsx";

type StageInspectorProps = {
  layout: InspectorLayout;
  onLayout: (change: InspectorLayoutChange) => void;
  initialTab: InspectorSection;
  onSlot: (section: InspectorSection, node: HTMLElement | null) => void;
};

const slotClass = "flex flex-col gap-3";

export function StageInspector({ layout, onLayout, initialTab, onSlot }: StageInspectorProps) {
  const { t } = useLingui();
  const [tab, setTab] = useState<InspectorSection>(initialTab);
  const objectsRef = useCallback(
    (node: HTMLDivElement | null) => onSlot("objects", node),
    [onSlot],
  );
  const displayRef = useCallback(
    (node: HTMLDivElement | null) => onSlot("display", node),
    [onSlot],
  );
  const labels: Record<InspectorSection, string> = { objects: t`Objects`, display: t`Display` };
  return (
    <InspectorDock
      layout={layout}
      onLayout={onLayout}
      panning={false}
      tabLabel={labels[tab]}
      tabCount={undefined}
    >
      <SidePanel
        data-testid="stage-inspector"
        width={layout.width}
        value={tab}
        onValueChange={(next) => setTab(next === "display" ? "display" : "objects")}
        tabs={[
          {
            value: "objects",
            label: labels.objects,
            body: <div ref={objectsRef} data-testid="inspector-objects" className={slotClass} />,
          },
          {
            value: "display",
            label: labels.display,
            body: <div ref={displayRef} data-testid="inspector-display" className={slotClass} />,
          },
        ]}
      />
    </InspectorDock>
  );
}
