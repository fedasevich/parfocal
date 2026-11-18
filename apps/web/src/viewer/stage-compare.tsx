import { useLingui } from "@lingui/react/macro";
import { ToolRailButton } from "@parfocal/ui/components/tool-rail-button";
import { destinations } from "../shell/destinations.ts";
import { useGoTo } from "../shell/router-link.tsx";

export function StageCompareButton({
  projectId,
  slideId,
  taskId,
  tipSide,
}: {
  projectId: string;
  slideId: string;
  taskId: string | undefined;
  tipSide: "top" | "right";
}) {
  const { t } = useLingui();
  const goTo = useGoTo();
  return (
    <ToolRailButton
      icon="slides"
      label={t`Compare slides`}
      tipSide={tipSide}
      data-testid="rail-compare"
      pressed={false}
      onPressedChange={() =>
        void goTo(destinations.compareSlides(projectId, slideId, taskId, "picking"))
      }
    />
  );
}
