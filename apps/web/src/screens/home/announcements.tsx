import {
  type Announcement,
  type AnnouncementKind,
  getGetMyHomeQueryKey,
  getListAnnouncementsQueryKey,
  useCreateAnnouncement,
  useEndAnnouncement,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { now } from "../../clock.ts";
import { relativeDay } from "../format.ts";
import { usePeople } from "../people.ts";
import {
  endsAtFor,
  kinds,
  type Lasts,
  lasts,
  looks,
  maxLength,
  textProblem,
  untilLabel,
} from "./announcement-rules.ts";
import { DotRow, SideCard } from "./cards.tsx";

const problemTitle = (body: unknown) => {
  const title = (body as { title?: unknown } | null)?.title;
  return typeof title === "string" ? title : "That did not work. Try again.";
};

function useRefreshAnnouncements() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetMyHomeQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() }),
    ]);
}

function PostDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateAnnouncement();
  const refresh = useRefreshAnnouncements();
  const [kind, setKind] = useState<AnnouncementKind>("change");
  const [text, setText] = useState("");
  const [lasting, setLasting] = useState<Lasts>("ended");
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string>();
  const problem = textProblem(text);
  const reset = () => {
    setKind("change");
    setText("");
    setLasting("ended");
    setTried(false);
    setFailure(undefined);
  };
  return (
    <SmallModal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
      title="Post an announcement"
      subtitle="Everyone in this workspace sees it on Home."
      width={560}
      primaryLabel="Post"
      primaryBusy={create.isPending}
      blockers={
        tried && problem
          ? [{ id: "text", text: problem, goTo: "Go to the text" }]
          : failure
            ? [{ id: "failure", text: failure, goTo: "Try again" }]
            : []
      }
      blockersTitle="Before you can post"
      onPrimary={() => {
        setTried(true);
        setFailure(undefined);
        if (problem) return;
        create.mutate(
          { data: { kind, text: text.trim(), ends_at: endsAtFor(lasting, now()) } },
          {
            onSuccess: (response) => {
              if (response.status !== 201) {
                setFailure(problemTitle(response.data));
                return;
              }
              void refresh();
              reset();
              onClose();
            },
          },
        );
      }}
    >
      <div className="grid gap-1.5">
        <span id="announcement-kind" className="text-caption font-semibold text-fg-dim">
          Kind
        </span>
        <SegmentedControl
          aria-labelledby="announcement-kind"
          value={kind}
          onValueChange={(value) => setKind(value as AnnouncementKind)}
          options={kinds.map(({ value, label }) => ({ value, label }))}
        />
        <small className="text-caption text-fg-dim">
          {kinds.find((option) => option.value === kind)?.hint}
        </small>
      </div>
      <FormField
        label="Text"
        error={tried ? problem : undefined}
        count={`${text.trim().length} of ${maxLength}`}
      >
        <TextFieldInput
          placeholder="What do you want people to know?"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </FormField>
      <div className="grid gap-1.5">
        <span id="announcement-lasts" className="text-caption font-semibold text-fg-dim">
          Stays for
        </span>
        <SegmentedControl
          aria-labelledby="announcement-lasts"
          value={lasting}
          onValueChange={(value) => setLasting(value as Lasts)}
          options={lasts.map(({ value, label }) => ({ value, label }))}
        />
      </div>
    </SmallModal>
  );
}

function AnnouncementRow({
  item,
  firstWeek,
  canPost,
}: {
  item: Announcement;
  firstWeek: boolean;
  canPost: boolean;
}) {
  const today = now();
  const personOf = usePeople();
  const end = useEndAnnouncement();
  const refresh = useRefreshAnnouncements();
  const look = looks[item.kind];
  const source = personOf(item.created_by_user_id)?.name ?? look.source;
  const until = canPost ? untilLabel(item.ends_at, today) : null;
  const sub = [source, relativeDay(new Date(item.created_at), today), until]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex items-start justify-between gap-2">
      <DotRow colour={firstWeek ? "var(--accent)" : look.colour} title={item.text} sub={sub} />
      {canPost ? (
        <Button
          variant="link"
          aria-label={`End announcement: ${item.text}`}
          disabled={end.isPending}
          onClick={() =>
            end.mutate({ announcementId: item.id }, { onSuccess: () => void refresh() })
          }
        >
          End
        </Button>
      ) : null}
    </div>
  );
}

export function Announcements({
  items,
  firstWeek,
  canPost,
}: {
  items: Announcement[];
  firstWeek: boolean;
  canPost: boolean;
}) {
  const [posting, setPosting] = useState(false);
  return (
    <SideCard
      title="Announcements"
      end={
        canPost ? (
          <Button variant="link" onClick={() => setPosting(true)}>
            Post
          </Button>
        ) : null
      }
    >
      {items.map((item) => (
        <AnnouncementRow key={item.id} item={item} firstWeek={firstWeek} canPost={canPost} />
      ))}
      {items.length === 0 ? (
        <span className="text-body-sm text-fg-dim">Nothing to announce right now.</span>
      ) : null}
      {canPost ? <PostDialog open={posting} onClose={() => setPosting(false)} /> : null}
    </SideCard>
  );
}
