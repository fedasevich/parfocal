import { Trans, useLingui } from "@lingui/react/macro";
import {
  ApiError,
  getGetJoinSettingsQueryKey,
  getGetMeQueryKey,
  type JoinPolicy,
  type JoinSettings,
  useGetJoinSettings,
  useSetJoinSettings,
} from "@parfocal/api-client";
import { WorkspaceLogo } from "@parfocal/ui/components/auth";
import { Button } from "@parfocal/ui/components/button";
import { Input } from "@parfocal/ui/components/input";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { okData } from "../placeholder.tsx";
import type { Notify } from "./common.tsx";
import {
  canSave,
  changeOf,
  checkDomain,
  domainHelp,
  domainNotYours,
  domainOf,
  draftOf,
  type JoinDraft,
  joinPolicyOptions,
  logoColours,
  logoOf,
  refusalText,
  savedText,
} from "./join-settings-model.ts";

const rows = "grid grid-cols-[200px_minmax(0,1fr)] items-start gap-x-4 gap-y-4 text-body-sm";

type Refusal = { domain: string; message: string };

function JoinForm({
  saved,
  workspaceName,
  notify,
}: {
  saved: JoinSettings;
  workspaceName: string;
  notify: Notify;
}) {
  const { t } = useLingui();

  const queryClient = useQueryClient();
  const save = useSetJoinSettings();
  const [draft, setDraft] = useState<JoinDraft>(draftOf(saved));
  const set = (next: Partial<JoinDraft>) => setDraft((current) => ({ ...current, ...next }));
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const check = checkDomain(draft.domain);
  const refused = refusal !== null && refusal.domain === domainOf(draft.domain);
  const wrong = check === "invalid" || check === "public" || refused;
  const submit = () => {
    const change = changeOf(draft);
    save.mutate(
      { data: change },
      {
        onError: (error) => {
          if (error instanceof ApiError && error.problem?.code === domainNotYours) {
            setRefusal({ domain: change.email_domain ?? "", message: refusalText });
            return;
          }
          notify(error instanceof Error ? error.message : "That did not save. Try again.");
        },
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetJoinSettingsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          notify(savedText(change));
        },
      },
    );
  };
  return (
    <form
      className={rows}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave(draft, saved) && !refused) submit();
      }}
    >
      <span className="pt-1.5 text-fg-dim">
        <Trans>Logo</Trans>
      </span>
      <div className="flex flex-wrap items-center gap-2.5">
        <WorkspaceLogo
          workspace={{
            name: workspaceName,
            logo: logoOf(draft.logo) || saved.logo,
            colour: draft.colour,
          }}
          size={32}
        />
        <Input
          aria-label={t`Logo letters`}
          value={draft.logo}
          maxLength={3}
          onChange={(event) => set({ logo: logoOf(event.target.value) })}
          className="w-20 font-mono uppercase"
        />
        <fieldset className="m-0 flex gap-1.5 border-0 p-0" aria-label={t`Logo colour`}>
          {logoColours.map((colour) => (
            <button
              key={colour}
              type="button"
              aria-label={t`Logo colour ${colour}`}
              aria-pressed={draft.colour === colour}
              onClick={() => set({ colour })}
              className={cn(
                "size-6 rounded-full border-2",
                draft.colour === colour ? "border-fg" : "border-transparent",
              )}
              style={{ backgroundColor: colour }}
            />
          ))}
        </fieldset>
      </div>
      <span className="pt-1.5 text-fg-dim">
        <Trans>Email domain</Trans>
      </span>
      <div className="grid justify-items-start gap-1.5">
        <Input
          aria-label={t`Email domain`}
          aria-invalid={wrong}
          aria-describedby="join-domain-help"
          placeholder={t`hospital.example`}
          maxLength={253}
          value={draft.domain}
          onChange={(event) => set({ domain: event.target.value })}
          className="w-72"
        />
        <small
          id="join-domain-help"
          className={cn("text-caption", wrong ? "text-bad" : "text-fg-dim")}
        >
          {refused ? refusal.message : domainHelp[check]}
        </small>
      </div>
      <span className="pt-1.5 text-fg-dim">
        <Trans>People from the domain</Trans>
      </span>
      <div className="grid justify-items-start gap-1.5">
        <SegmentedControl
          aria-label={t`People from the domain`}
          value={draft.policy}
          onValueChange={(value) => set({ policy: String(value) as JoinPolicy })}
          options={joinPolicyOptions.map((option) => ({ ...option }))}
        />
        <small className="text-caption text-fg-dim">
          {draft.policy === "join"
            ? t`They join as reviewers without anyone saying yes.`
            : t`They ask, and someone with admin rights answers in Join requests on People.`}
        </small>
      </div>
      <span />
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={!canSave(draft, saved) || refused || save.isPending}
        >
          <Trans>Apply</Trans>
        </Button>
      </div>
    </form>
  );
}

export function JoinSettingsZone({
  workspaceName,
  notify,
}: {
  workspaceName: string;
  notify: Notify;
}) {
  const { t } = useLingui();

  const saved = okData(useGetJoinSettings().data);
  if (saved === undefined) return null;
  return (
    <Zone
      title={t`Logo and joining`}
      sub="The logo shows next to Parfocal. The email domain decides who can find this workspace when they set up."
    >
      <JoinForm
        key={JSON.stringify(saved)}
        saved={saved}
        workspaceName={workspaceName}
        notify={notify}
      />
    </Zone>
  );
}
