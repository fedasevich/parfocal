import { useGetMe } from "@parfocal/api-client";
import { AvatarStack } from "@parfocal/ui/components/person";
import { okData } from "../screens/placeholder.tsx";
import { usePeople } from "../screens/project/people.ts";
import { useRoomPresence } from "./use-room-presence.ts";

export function ViewingNow({ slideId }: { slideId: string }) {
  const me = okData(useGetMe().data)?.user_id;
  const present = useRoomPresence(`slide:${slideId}`, me);
  const people = usePeople();
  if (present.size === 0) return null;
  const viewers = [...present].map((id) => people.byId(id));
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
