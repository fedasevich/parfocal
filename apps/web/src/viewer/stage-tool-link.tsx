import { type RefObject, useEffect, useRef } from "react";

export type ArmTool = (tool: string) => void;

export function StageToolLink({
  armTool,
  link,
  armFirst,
}: {
  armTool: ArmTool;
  link: RefObject<ArmTool | null>;
  armFirst?: string | undefined;
}) {
  const armedFirst = useRef(false);
  useEffect(() => {
    link.current = armTool;
    if (armFirst !== undefined && !armedFirst.current) {
      armedFirst.current = true;
      armTool(armFirst);
    }
    return () => {
      link.current = null;
    };
  }, [armTool, link, armFirst]);
  return null;
}
