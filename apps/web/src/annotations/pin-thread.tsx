import {
  getGetThreadQueryKey,
  getListThreadsQueryKey,
  type Thread,
  useGetMe,
  useGetThread,
  useReopenThread,
  useReplyToThread,
  useResolveThread,
} from "@parfocal/api-client";
import { ThreadPopover } from "@parfocal/ui/components/thread-popover";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { now } from "../clock.ts";
import { usePeople } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import type { AnnotationDocument } from "./document.ts";
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
  const { task_id: taskId, slide_id: slideId, id: threadId } = thread;
  const queryClient = useQueryClient();
  const person = usePeople();
  const me = okData(useGetMe().data);
  const detail = okData(useGetThread(taskId, slideId, threadId).data);
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
    void queryClient.invalidateQueries({
      queryKey: getGetThreadQueryKey(taskId, slideId, threadId),
    });
    void queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey(taskId, slideId) });
  };
  const replying = useReplyToThread({
    mutation: {
      onSuccess: (response) => {
        if (response.status >= 300) return;
        setReply("");
        refresh();
      },
    },
  });
  const resolving = useResolveThread({
    mutation: {
      onSuccess: (response) => {
        if (response.status >= 300) return;
        refresh();
        onClose();
      },
    },
  });
  const reopening = useReopenThread({
    mutation: {
      onSuccess: (response) => {
        if (response.status >= 300) return;
        refresh();
      },
    },
  });

  const resolved = (detail ?? thread).resolved_at !== null;
  const send = () => {
    const body = reply.trim();
    if (body === "" || replying.isPending) return;
    replying.mutate({ taskId, slideId, threadId, data: { body } });
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
          if (resolved) reopening.mutate({ taskId, slideId, threadId });
          else resolving.mutate({ taskId, slideId, threadId });
        }}
        onClose={onClose}
      />
    </div>
  );
}
