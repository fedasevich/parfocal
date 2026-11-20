import { ToolRail, ToolRailGroup } from "@parfocal/ui/components/tool-rail-button";
import type { RailTool } from "../screens/review/viewer-frame.tsx";
import { type CompareToggle, StageCompareButton } from "./stage-compare.tsx";
import { StageRailButton } from "./stage-rail-button.tsx";

type StageRailProps = {
  rail: readonly (readonly RailTool[])[];
  tool: string;
  onTool: (next: string | null) => void;
  compareToggle: CompareToggle | undefined;
};

const groupKey = (group: readonly RailTool[]) => group.map((item) => item.tool).join("-");

function buttons(group: readonly RailTool[], props: StageRailProps, dock: boolean) {
  return group.map((item) => (
    <StageRailButton
      key={item.tool}
      item={item}
      tool={props.tool}
      dock={dock}
      onTool={props.onTool}
    />
  ));
}

export function StageSideRail(props: StageRailProps) {
  return (
    <ToolRail className="justify-between">
      <div className="grid gap-1">
        {props.rail.map((group) => (
          <ToolRailGroup key={groupKey(group)}>{buttons(group, props, false)}</ToolRailGroup>
        ))}
      </div>
      {props.compareToggle ? (
        <ToolRailGroup>
          <StageCompareButton toggle={props.compareToggle} />
        </ToolRailGroup>
      ) : null}
    </ToolRail>
  );
}

export function StageDockTools(props: StageRailProps) {
  return (
    <div
      data-slot="stage-tools"
      className="absolute bottom-3.5 left-1/2 z-6 flex -translate-x-1/2 items-center gap-0.5 rounded-zone border border-line bg-chrome p-1.25 shadow-pop"
    >
      {props.rail.map((group) => (
        <div
          key={groupKey(group)}
          className="flex gap-0.5 border-r border-line px-1 last:border-r-0"
        >
          {buttons(group, props, true)}
        </div>
      ))}
      {props.compareToggle ? (
        <div className="flex px-1">
          <StageCompareButton toggle={props.compareToggle} />
        </div>
      ) : null}
    </div>
  );
}
