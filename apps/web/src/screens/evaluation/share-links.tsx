import {
  type CreatedReportLink,
  type ReportLink,
  useCreateReportLink,
  useListReportLinks,
  useRevokeReportLink,
} from "@parfocal/api-client";
import { InlineError } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { SmallModal, SmallModalZone } from "@parfocal/ui/components/small-modal";
import { StatusTag } from "@parfocal/ui/components/tag";
import { useState } from "react";
import { okData } from "../placeholder.tsx";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const times = (count: number) => (count === 1 ? "once" : `${count} times`);

function stateOf(link: ReportLink) {
  if (link.revoked_at !== null) return { tone: "neutral", label: "Revoked" } as const;
  if (link.expired) return { tone: "neutral", label: "Expired" } as const;
  return { tone: "ok", label: "Active" } as const;
}

export function ShareLinks({ taskId, taskCode }: { taskId: string; taskCode: string }) {
  const [open, setOpen] = useState(false);
  const listed = useListReportLinks(taskId, { query: { enabled: open, staleTime: 0 } });
  const links = okData(listed.data) ?? [];
  const create = useCreateReportLink();
  const revoke = useRevokeReportLink();
  const [fresh, setFresh] = useState<CreatedReportLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const make = () => {
    setFailed(false);
    create.mutate(
      { taskId },
      {
        onSuccess: (response) => {
          if (response.status === 201) setFresh(response.data);
          setCopied(false);
          void listed.refetch();
        },
        onError: () => setFailed(true),
      },
    );
  };
  const withdraw = (link: ReportLink) =>
    revoke.mutate(
      { taskId, linkId: link.id },
      {
        onSuccess: () => {
          if (fresh?.id === link.id) setFresh(null);
          void listed.refetch();
        },
        onError: () => setFailed(true),
      },
    );
  const copy = () => {
    if (!fresh) return;
    void navigator.clipboard
      ?.writeText(fresh.url)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };
  return (
    <SmallModal
      open={open}
      onOpenChange={setOpen}
      width={560}
      title={`Share ${taskCode} read-only`}
      subtitle="Anyone with the link sees the numbers of this report without signing in. No slides, no names and no free text. A link lasts 30 days."
      trigger={
        <Button>
          <Icon name="link" />
          Read-only link
        </Button>
      }
      primaryLabel="Make a link"
      onPrimary={make}
      primaryBusy={create.isPending}
      cancelLabel="Close"
    >
      {fresh ? (
        <SmallModalZone title="New link">
          <div className="flex gap-2">
            <Input
              readOnly
              aria-label="New link"
              value={fresh.url}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
          </div>
          <span className="text-body-sm text-fg-dim">
            Copy it now. Parfocal keeps only a fingerprint and cannot show it again.
          </span>
        </SmallModalZone>
      ) : null}
      {failed ? <InlineError>The link could not be changed. Try again.</InlineError> : null}
      <SmallModalZone title="Links to this report">
        {links.length === 0 ? (
          <span className="text-body-sm text-fg-dim">No links yet.</span>
        ) : (
          <ul aria-label="Report links" className="m-0 grid list-none gap-2 p-0">
            {links.map((link) => {
              const state = stateOf(link);
              const active = state.label === "Active";
              return (
                <li
                  key={link.id}
                  className="flex items-center gap-3 rounded-ctl bg-chrome-2 px-3 py-2"
                >
                  <span className="grid min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium text-fg">
                      Made {day(link.created_at)}
                      <StatusTag tone={state.tone}>{state.label}</StatusTag>
                    </span>
                    <small className="text-caption text-fg-dim">
                      {active
                        ? `Until ${day(link.expires_at)}`
                        : `Ended ${day(link.revoked_at ?? link.expires_at)}`}
                      {" · "}
                      {link.opened_count === 0
                        ? "Not opened"
                        : `Opened ${times(link.opened_count)}`}
                    </small>
                  </span>
                  {active ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={revoke.isPending}
                      onClick={() => withdraw(link)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SmallModalZone>
    </SmallModal>
  );
}
