import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  type Invitation,
  type Member,
  useCancelMemberDeactivation,
  useDeactivateMember,
  useGetMemberOpenWork,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { DatePicker } from "@parfocal/ui/components/date-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { FormField } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useState } from "react";
import { now } from "../../clock.ts";
import { formatDue } from "../format.ts";
import { okData } from "../placeholder.tsx";
import type { Notify } from "./common.tsx";
import type { MemberAction } from "./people-rules.ts";

export function problemText(body: unknown): string {
  const title = (body as { title?: unknown } | null)?.title;
  return typeof title === "string" ? title : t`That did not work. Try again.`;
}

const isoDay = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

function MenuButton({ label }: { label: string }) {
  return (
    <DropdownMenuTrigger
      render={<Button variant="ghost" size="icon-sm" aria-label={label} title={label} />}
    >
      <Icon name="more" />
    </DropdownMenuTrigger>
  );
}

export function MemberMenu({
  member,
  actions,
  onRole,
  onToggleRight,
  notify,
  onChanged,
}: {
  member: Member;
  actions: MemberAction[];
  onRole: (role: Member["role"]) => void;
  onToggleRight: () => void;
  notify: Notify;
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const [removing, setRemoving] = useState(false);
  const cancel = useCancelMemberDeactivation();
  if (actions.length === 0) return null;
  const cancelRemoval = () =>
    cancel.mutate(
      { userId: member.user_id },
      {
        onSuccess: (response) => {
          if (response.status !== 204) {
            notify(problemText(response.data));
            return;
          }
          onChanged();
          notify(t`${member.display_name} stays in the workspace.`);
        },
      },
    );
  const action: Record<Exclude<MemberAction, "remove">, { label: string; run: () => void }> = {
    "make-researcher": { label: t`Make a researcher`, run: () => onRole("researcher") },
    "make-reviewer": { label: t`Make a reviewer`, run: () => onRole("reviewer") },
    "give-admin": { label: t`Give admin rights`, run: onToggleRight },
    "remove-admin": { label: t`Remove admin rights`, run: onToggleRight },
    "cancel-removal": { label: t`Cancel the scheduled removal`, run: cancelRemoval },
  };
  const others = actions.filter((one): one is Exclude<MemberAction, "remove"> => one !== "remove");
  return (
    <>
      <DropdownMenu>
        <MenuButton label={t`More for ${member.display_name}`} />
        <DropdownMenuContent align="end" className="w-56">
          {others.map((name) => (
            <DropdownMenuItem key={name} onClick={action[name].run}>
              {action[name].label}
            </DropdownMenuItem>
          ))}
          {actions.includes("remove") ? (
            <>
              {others.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem variant="destructive" onClick={() => setRemoving(true)}>
                <Trans>Remove from the workspace</Trans>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {removing ? (
        <RemoveMemberModal
          member={member}
          notify={notify}
          onChanged={onChanged}
          onClose={() => setRemoving(false)}
        />
      ) : null}
    </>
  );
}

function RemoveMemberModal({
  member,
  notify,
  onChanged,
  onClose,
}: {
  member: Member;
  notify: Notify;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const work = okData(useGetMemberOpenWork(member.user_id).data);
  const deactivate = useDeactivateMember();
  const [endsOn, setEndsOn] = useState("");
  const today = isoDay(now());
  const leaveDay = endsOn === "" ? "" : formatDue(endsOn);
  const remove = () => {
    if (work === undefined) return;
    deactivate.mutate(
      {
        userId: member.user_id,
        data: {
          ends_on: endsOn === "" ? null : endsOn,
          handovers: work.items.map((item) => ({
            kind: item.kind,
            id: item.id,
            action: "return" as const,
          })),
        },
      },
      {
        onSuccess: (response) => {
          if (response.status !== 200) {
            notify(problemText(response.data));
            return;
          }
          onChanged();
          notify(
            endsOn === ""
              ? t`${member.display_name} was removed and can no longer sign in here.`
              : t`${member.display_name} will be removed on ${leaveDay}.`,
          );
          onClose();
        },
      },
    );
  };
  return (
    <SmallModal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t`Remove ${member.display_name} from the workspace`}
      subtitle={t`They can no longer sign in here. Their decisions, sign-offs and audit entries stay as they are.`}
      primaryLabel={t`Remove ${member.display_name}`}
      primaryBusy={deactivate.isPending}
      primaryDisabled={work === undefined}
      onPrimary={remove}
      hint={t`With a date they keep access until then, and you can cancel before it comes.`}
    >
      {work === undefined ? null : work.items.length === 0 ? (
        <p className="m-0 text-body-sm text-fg-dim">
          <Trans>They have no open work.</Trans>
        </p>
      ) : (
        <div className="grid gap-2">
          <span className="text-caption font-semibold text-fg-dim">
            <Trans>Open work that goes back</Trans>
          </span>
          <ul className="m-0 grid gap-1 pl-4 text-body-sm">
            {work.items.map((item) => (
              <li key={item.id}>
                {item.label} <span className="font-mono text-fg-dim">{item.count}</span>
              </li>
            ))}
          </ul>
          <small className="text-caption text-fg-dim">
            <Trans>
              Slides go back to the pool, tasks to the project owners, adjudications to the queue,
              and open threads are resolved.
            </Trans>
          </small>
        </div>
      )}
      <FormField label={t`Remove on, optional`}>
        <DatePicker
          aria-label={t`Remove on`}
          value={endsOn}
          min={isoDay(new Date(now().getTime() + 24 * 60 * 60 * 1000))}
          today={today}
          placeholder={t`Now`}
          onValueChange={setEndsOn}
        />
      </FormField>
    </SmallModal>
  );
}

export function InviteMenu({
  invitation,
  onResend,
  onRevoke,
  revoking,
}: {
  invitation: Invitation;
  onResend: () => void;
  onRevoke: (done: () => void) => void;
  revoking: boolean;
}) {
  const { t } = useLingui();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <DropdownMenu>
        <MenuButton label={t`More for ${invitation.email}`} />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={onResend}>
            <Trans>Resend the invite</Trans>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setAsking(true)}>
            <Trans>Revoke the invite</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {asking ? (
        <SmallModal
          open
          onOpenChange={(next) => {
            if (!next) setAsking(false);
          }}
          title={t`Revoke the invite to ${invitation.email}`}
          subtitle={t`The link in their email stops working. You can invite them again later.`}
          primaryLabel={t`Revoke invite`}
          primaryBusy={revoking}
          onPrimary={() => onRevoke(() => setAsking(false))}
        />
      ) : null}
    </>
  );
}
