import { useLingui } from "@lingui/react/macro";
import { ToolRailButton } from "@parfocal/ui/components/tool-rail-button";
import { useToolsLayout } from "../shell/tools-layout.ts";

export type CompareToggle = {
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
};

export function StageCompareButton({ toggle }: { toggle: CompareToggle }) {
  const { t } = useLingui();
  const tipSide = useToolsLayout() === "dock" ? "top" : "right";
  return (
    <ToolRailButton
      icon="slides"
      label={toggle.on ? t`Close compare` : t`Compare slides`}
      tipSide={tipSide}
      data-testid="rail-compare"
      pressed={toggle.on}
      onPressedChange={toggle.onChange}
    />
  );
}
