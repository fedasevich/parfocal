import { getListThreadsQueryKey, useCreateThread } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { CommentComposer } from "@parfocal/ui/components/comment-thread";
import { Icon } from "@parfocal/ui/components/icon";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type Pin, pinOnScreen, pinThread } from "./comment-pin.ts";
import type { Camera } from "./slide-still.tsx";

type Size = { width: number; height: number };

export function PinMark({ pin, camera, size }: { pin: Pin; camera: Camera; size: Size }) {
  const at = pinOnScreen(camera, size, pin);
  return (
    <span
      data-slot="comment-pin"
      aria-hidden
      className="pointer-events-none absolute grid size-7 -translate-x-1/2 -translate-y-full place-items-center rounded-full rounded-bl-none bg-accent-fill text-on-accent shadow-md"
      style={{ left: at.x, top: at.y }}
    >
      <Icon name="comment" />
    </span>
  );
}

type PinnedThreadProps = {
  pin: Pin;
  taskId: string;
  slideId: string;
  offReason?: string | undefined;
  onPosted: () => void;
  onCancel: () => void;
};

export function PinnedThread({
  pin,
  taskId,
  slideId,
  offReason,
  onPosted,
  onCancel,
}: PinnedThreadProps) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const create = useCreateThread({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey(taskId, slideId) });
        onPosted();
      },
    },
  });
  const send = () => {
    const data = pinThread(pin, draft);
    if (data === null || create.isPending) return;
    create.mutate({ taskId, slideId, data });
  };
  return (
    <section
      aria-label="New pinned thread"
      data-testid="pinned-thread"
      className="grid gap-3"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) onCancel();
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-body font-semibold text-fg">New thread at the pin</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="m-0 text-body-sm text-fg-dim">
        Pinned at {Math.round(pin.x)}, {Math.round(pin.y)} on the slide. Click the slide again to
        move the pin.
      </p>
      <CommentComposer
        value={draft}
        onValueChange={setDraft}
        onSend={send}
        label="Comment at the pin"
        hint="Everyone on the task sees it."
        offReason={offReason}
      />
      {create.isError ? (
        <p role="alert" className="m-0 text-body-sm text-bad">
          The thread did not save. Try again.
        </p>
      ) : null}
    </section>
  );
}
