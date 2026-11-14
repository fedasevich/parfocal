import { useGetMe } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { AvatarStack } from "@parfocal/ui/components/person";
import { okData } from "../screens/placeholder.tsx";
import { firstName, usePeople } from "../screens/project/people.ts";
import { viewersOf } from "./presence-state.ts";
import { useBlindedOn } from "./use-blinded.ts";
import { useFollowView } from "./use-follow-view.ts";
import { useRoomPresence } from "./use-room-presence.ts";

const pressedLook = "aria-pressed:border-accent aria-pressed:bg-accent-soft";

export function ViewingNow({ slideId, taskId }: { slideId: string; taskId: string | undefined }) {
  const me = okData(useGetMe().data)?.user_id;
  const view = useFollowView(slideId, me, useBlindedOn(taskId, slideId));
  const people = usePeople();
  if (view.present.length === 0) return null;
  const viewers = view.present.map((id) => people.byId(id));
  return (
    <>
      {view.available
        ? view.sharers.map((id) => {
            const person = people.byId(id);
            const followed = view.following === id;
            return (
              <Button
                key={id}
                size="xs"
                data-testid="follow-view"
                aria-pressed={followed}
                title={
                  followed
                    ? `You see what ${person.name} sees until you move the slide`
                    : `See what ${person.name} sees until you move the slide`
                }
                className={pressedLook}
                onClick={() => view.follow(followed ? null : id)}
              >
                {followed ? `Following ${firstName(person)}` : `Follow ${firstName(person)}`}
              </Button>
            );
          })
        : null}
      {view.available ? (
        <Button
          size="xs"
          data-testid="share-view"
          aria-pressed={view.sharing}
          title={
            view.sharing
              ? "Others on this slide can follow where you look. Click to stop"
              : "Let others on this slide follow where you look"
          }
          className={pressedLook}
          onClick={() => view.setSharing(!view.sharing)}
        >
          {view.sharing ? "Sharing my view" : "Share my view"}
        </Button>
      ) : null}
      <AvatarStack
        data-testid="presence"
        people={viewers}
        max={3}
        size={24}
        aria-label={`Also viewing now: ${viewers.map((person) => person.name).join(", ")}`}
        className="mr-1"
      />
    </>
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
