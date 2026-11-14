import { Trans, useLingui } from "@lingui/react/macro";
import { getListThreadsQueryKey, useCreateThread } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { CommentComposer } from "@parfocal/ui/components/comment-thread";
import { Icon } from "@parfocal/ui/components/icon";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { markTried } from "../home/getting-started.ts";
import { type Pin, pinOnScreen, pinThread } from "./comment-pin.ts";
import type { Camera } from "./slide-still.tsx";
import { useMentionable } from "./use-mentionable.ts";

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
  const { t } = useLingui();
  const pinX = Math.round(pin.x);
  const pinY = Math.round(pin.y);
  const [draft, setDraft] = useState("");
  const members = useMentionable();
  const queryClient = useQueryClient();
  const create = useCreateThread({
    mutation: {
      onSuccess: () => {
        markTried("comment");
        void queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey(taskId, slideId) });
        onPosted();
      },
    },
  });
  const send = () => {
    const data = pinThread(pin, draft, members);
    if (data === null || create.isPending) return;
    create.mutate({ taskId, slideId, data });
  };
  return (
    <section
      aria-label={t`New pinned thread`}
      data-testid="pinned-thread"
      className="grid gap-3"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) onCancel();
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-body font-semibold text-fg">
          <Trans>New thread at the pin</Trans>
        </span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
      </div>
      <p className="m-0 text-body-sm text-fg-dim">
        <Trans>
          Pinned at {pinX}, {pinY} on the slide. Click the slide again to move the pin.
        </Trans>
      </p>
      <CommentComposer
        value={draft}
        onValueChange={setDraft}
        onSend={send}
        label={t`Comment at the pin`}
        hint={t`Everyone on the task sees it.`}
        offReason={offReason}
      />
      {create.isError ? (
        <p role="alert" className="m-0 text-body-sm text-bad">
          <Trans>The thread did not save. Try again.</Trans>
        </p>
      ) : null}
    </section>
  );
}
