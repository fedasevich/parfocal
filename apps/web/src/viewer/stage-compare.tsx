import { useLingui } from "@lingui/react/macro";
import { ToolRailButton } from "@parfocal/ui/components/tool-rail-button";
import { destinations } from "../shell/destinations.ts";
import { useGoTo } from "../shell/router-link.tsx";
import { useToolsLayout } from "../shell/tools-layout.ts";
import type { SlideWorkspace } from "./workspace.ts";

export function StageCompareButton({
  projectId,
  slideId,
  taskId,
  workspace,
}: {
  projectId: string;
  slideId: string;
  taskId: string | undefined;
  workspace: SlideWorkspace;
}) {
  const { t } = useLingui();
  const goTo = useGoTo();
  const tipSide = useToolsLayout() === "dock" ? "top" : "right";
  return (
    <ToolRailButton
      icon="slides"
      label={t`Compare slides`}
      tipSide={tipSide}
      data-testid="rail-compare"
      pressed={false}
      onPressedChange={() =>
        void goTo(
          destinations.compareSlides(projectId, slideId, taskId, "picking", undefined, workspace),
        )
      }
    />
  );
}
