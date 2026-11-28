import { type Thread, useGetMe } from "@parfocal/api-client";
import { ThreadPopover } from "@parfocal/ui/components/thread-popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { now } from "../clock.ts";
import { usePeople } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import { useMentionable } from "../screens/review/use-mentionable.ts";
import { shapeOfObject } from "./anchor-place.ts";
import type { AnnotationDocument } from "./document.ts";
import { useSavedCodes } from "./drawn-object-ids.ts";
import { useReferencePicking } from "./reference-picker.tsx";
import { commentBody } from "./reference-tokens.ts";
import {
  homeOf,
  markResolved,
  readThread,
  replyInThread,
  threadKey,
  threadListKey,
} from "./thread-home.ts";
import {
  type PopoverSpot,
  pendingMessageLines,
  threadMeasurement,
  threadMessages,
} from "./thread-popover.ts";

type PinThreadProps = {
  thread: Thread;
  document: AnnotationDocument;
  micronsPerPixel: number | null;
  spot: PopoverSpot | null;
  onClose: () => void;
};

export function PinThread({
  thread,
  document: doc,
  micronsPerPixel,
  spot,
  onClose,
}: PinThreadProps) {
  const threadId = thread.id;
  const home = homeOf(thread);
  const queryClient = useQueryClient();
  const person = usePeople();
  const members = useMentionable();
  const codes = useSavedCodes();
  const me = okData(useGetMe().data);
  const detail = okData(
    useQuery({ queryKey: threadKey(home, threadId), queryFn: () => readThread(home, threadId) })
      .data,
  );
  const [reply, setReply] = useState("");
  const referencing = useReferencePicking(reply, setReply);
  const section = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    section.current?.querySelector("textarea")?.focus();
  }, []);

  const floating = spot !== null;
  useEffect(() => {
    if (!floating) return;
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (section.current?.contains(target)) return;
      if (target.closest('[data-slot="comment-pin"]')) return;
      onClose();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [onClose, floating]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: threadKey(home, threadId) });
    void queryClient.invalidateQueries({ queryKey: threadListKey(home) });
  };
  const replying = useMutation({
    mutationFn: (body: string) =>
      replyInThread(home, threadId, { body: commentBody(body, members) }),
    onSuccess: (response) => {
      if (response.status >= 300) return;
      setReply("");
      refresh();
    },
  });
  const resolving = useMutation({
    mutationFn: () => markResolved(home, threadId, true),
    onSuccess: (response) => {
      if (response.status >= 300) return;
      refresh();
      onClose();
    },
  });
  const reopening = useMutation({
    mutationFn: () => markResolved(home, threadId, false),
    onSuccess: (response) => {
      if (response.status >= 300) return;
      refresh();
    },
  });

  const resolved = (detail ?? thread).resolved_at !== null;
  const send = () => {
    const body = reply.trim();
    if (body === "" || replying.isPending) return;
    replying.mutate(body);
  };
  const failed = [replying, resolving, reopening].some(
    (mutation) => mutation.isError || (mutation.data !== undefined && mutation.data.status >= 300),
  );

  return (
    <div
      ref={section}
      data-testid="pin-thread"
      data-thread={threadId}
      className={spot === null ? "grid" : "pointer-events-auto absolute z-10"}
      style={spot === null ? undefined : { left: spot.left, top: spot.top }}
    >
      <ThreadPopover
        title={thread.title}
        resolved={resolved}
        loading={detail === undefined}
        pendingLines={pendingMessageLines(thread.title, thread.message_count)}
        messages={threadMessages(detail?.messages ?? [], person, me?.user_id, now())}
        measurement={threadMeasurement(
          doc,
          threadId,
          micronsPerPixel,
          codes,
          thread.anchor.object_id
            ? shapeOfObject({ doc, codes, areas: [] }, thread.anchor.object_id)
            : null,
        )}
        reply={reply}
        onReplyChange={setReply}
        replyPicker={referencing?.picker}
        onReplyPickerKey={referencing?.onPickerKey}
        onSend={send}
        busy={replying.isPending}
        failed={failed}
        onToggleResolved={() => {
          if (resolved) reopening.mutate();
          else resolving.mutate();
        }}
        onClose={onClose}
      />
    </div>
  );
}
