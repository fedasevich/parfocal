import { type RefObject, useEffect } from "react";

export type ArmTool = (tool: string) => void;

export function StageToolLink({
  armTool,
  link,
}: {
  armTool: ArmTool;
  link: RefObject<ArmTool | null>;
}) {
  useEffect(() => {
    link.current = armTool;
    return () => {
      link.current = null;
    };
  }, [armTool, link]);
  return null;
}
