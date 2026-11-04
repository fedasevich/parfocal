import { useGetMe } from "@parfocal/api-client";
import { AvatarStack } from "@parfocal/ui/components/person";
import { okData } from "../screens/placeholder.tsx";
import { usePeople } from "../screens/project/people.ts";
import { viewersOf } from "./presence-state.ts";
import { useRoomPresence } from "./use-room-presence.ts";

export function ViewingNow({ slideId }: { slideId: string }) {
  const me = okData(useGetMe().data)?.user_id;
  const present = viewersOf(useRoomPresence(`slide:${slideId}`, me));
  const people = usePeople();
  if (present.length === 0) return null;
  const viewers = present.map((id) => people.byId(id));
  return (
    <AvatarStack
      data-testid="presence"
      people={viewers}
      max={3}
      size={24}
      aria-label={`Also viewing now: ${viewers.map((person) => person.name).join(", ")}`}
      className="mr-1"
    />
  );
}

export function useProjectViewers(projectId: string): (slideId: string) => string[] {
  const me = okData(useGetMe().data)?.user_id;
  const present = useRoomPresence(`project:${projectId}`, me);
  return (slideId) => viewersOf(present, slideId);
}

export function SlideViewers({ viewers }: { viewers: string[] }) {
  const people = usePeople();
  if (viewers.length === 0) return null;
  const shown = viewers.map((id) => people.byId(id));
  return (
    <AvatarStack
      data-testid="slide-viewers"
      people={shown}
      max={3}
      size={20}
      aria-label={`Viewing now: ${shown.map((person) => person.name).join(", ")}`}
      className="ml-2"
    />
  );
}
