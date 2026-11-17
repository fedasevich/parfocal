import { useLingui } from "@lingui/react/macro";
import { SidePanel } from "@parfocal/ui/components/side-panel";
import { type ReactNode, useCallback } from "react";
import { InspectorDock } from "../screens/review/inspector-dock.tsx";
import type { InspectorLayout, InspectorLayoutChange } from "../screens/review/inspector-layout.ts";
import { type ViewerTab, viewerTabs } from "../screens/viewer/viewer-scenes.ts";
import type { InspectorSection } from "./inspector-slots.tsx";
import type { ViewerModule } from "./magnification-control.tsx";
import type { ThreadFocusRequest } from "./thread-focus.tsx";
import type { ViewerEngine } from "./viewer-engine.ts";

type StageInspectorProps = {
  layout: InspectorLayout;
  onLayout: (change: InspectorLayoutChange) => void;
  tab: ViewerTab;
  onTab: (tab: ViewerTab) => void;
  panning: boolean;
  comments: ReactNode;
  opinion: ReactNode;
  onSlot: (section: InspectorSection, node: HTMLElement | null) => void;
};

export type StageInspectorLink = {
  readonly tab: ViewerTab | undefined;
  readonly onTab: (tab: ViewerTab) => void;
  readonly comments: ReactNode;
  readonly opinion: ReactNode;
  readonly focus?: ThreadFocusRequest | null;
  readonly extras?: (session: StageSession) => ReactNode;
};

export type StageSession = { readonly engine: ViewerEngine; readonly module: ViewerModule };

const slotClass = "flex flex-col gap-3";

const isTab = (value: string): value is ViewerTab =>
  (viewerTabs as readonly string[]).includes(value);

export function StageInspector({
  layout,
  onLayout,
  tab,
  onTab,
  panning,
  comments,
  opinion,
  onSlot,
}: StageInspectorProps) {
  const { t } = useLingui();
  const objectsRef = useCallback(
    (node: HTMLDivElement | null) => onSlot("objects", node),
    [onSlot],
  );
  const displayRef = useCallback(
    (node: HTMLDivElement | null) => onSlot("display", node),
    [onSlot],
  );
  const labels: Record<ViewerTab, string> = {
    objects: t`Objects`,
    display: t`Display`,
    comments: t`Comments`,
    opinion: t`Opinion`,
  };
  return (
    <InspectorDock
      layout={layout}
      onLayout={onLayout}
      panning={panning}
      tabLabel={labels[tab]}
      tabCount={undefined}
    >
      <SidePanel
        data-testid="stage-inspector"
        data-tab={tab}
        width={layout.width}
        value={tab}
        onValueChange={(next) => {
          if (isTab(next)) onTab(next);
        }}
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
          { value: "comments", label: labels.comments, body: comments },
          { value: "opinion", label: labels.opinion, body: opinion },
        ]}
      />
    </InspectorDock>
  );
}
