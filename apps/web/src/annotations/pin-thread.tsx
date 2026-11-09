import { type Thread, useGetMe } from "@parfocal/api-client";
import { ThreadPopover } from "@parfocal/ui/components/thread-popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { now } from "../clock.ts";
import { usePeople } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import { toMentionTokens } from "../screens/review/mention-picking.ts";
import { useMentionable } from "../screens/review/use-mentionable.ts";
import type { AnnotationDocument } from "./document.ts";
import {
  homeOf,
  markResolved,
  readThread,
  replyInThread,
  threadKey,
  threadListKey,
} from "./thread-home.ts";
import { type PopoverSpot, threadMeasurement, threadMessages } from "./thread-popover.ts";

type PinThreadProps = {
  thread: Thread;
  document: AnnotationDocument;
  micronsPerPixel: number | null;
  spot: PopoverSpot;
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
  const me = okData(useGetMe().data);
  const detail = okData(
    useQuery({ queryKey: threadKey(home, threadId), queryFn: () => readThread(home, threadId) })
      .data,
  );
  const [reply, setReply] = useState("");
  const section = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    section.current?.querySelector("textarea")?.focus();
  }, []);

  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (section.current?.contains(target)) return;
      if (target.closest('[data-slot="comment-pin"]')) return;
      onClose();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [onClose]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: threadKey(home, threadId) });
    void queryClient.invalidateQueries({ queryKey: threadListKey(home) });
  };
  const replying = useMutation({
    mutationFn: (body: string) =>
      replyInThread(home, threadId, { body: toMentionTokens(body, members) }),
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
      className="pointer-events-auto absolute z-10"
      style={{ left: spot.left, top: spot.top }}
    >
      <ThreadPopover
        title={thread.title}
        resolved={resolved}
        loading={detail === undefined}
        messages={threadMessages(detail?.messages ?? [], person, me?.user_id, now())}
        measurement={threadMeasurement(doc, threadId, micronsPerPixel)}
        reply={reply}
        onReplyChange={setReply}
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
