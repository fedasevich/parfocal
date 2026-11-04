import { useListTenantMembers } from "@parfocal/api-client";
import { toPersonInfo } from "../people.ts";
import { okData } from "../placeholder.tsx";
import type { TaskPeople } from "./fake-task.ts";

export function useTaskPeople(): TaskPeople | undefined {
  const members = okData(useListTenantMembers().data);
  if (members === undefined) return undefined;
  const find = (initials: string) => {
    const member = members.find((item) => item.initials === initials);
    return member === undefined ? undefined : toPersonInfo(member);
  };
  const me = find("LM");
  const anna = find("AK");
  const simona = find("SM");
  if (me === undefined || anna === undefined || simona === undefined) {
    return undefined;
  }
  return { me, anna, simona };
}
