import {
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
  draftOf,
  type JoinDraft,
  joinPolicyOptions,
  logoColours,
  logoOf,
  savedText,
} from "./join-settings-model.ts";

const rows = "grid grid-cols-[200px_minmax(0,1fr)] items-start gap-x-4 gap-y-4 text-body-sm";

const problemText = (body: unknown): string =>
  typeof body === "object" && body !== null && "title" in body && typeof body.title === "string"
    ? body.title
    : "That did not save. Try again.";

function JoinForm({
  saved,
  workspaceName,
  notify,
}: {
  saved: JoinSettings;
  workspaceName: string;
  notify: Notify;
}) {
  const queryClient = useQueryClient();
  const save = useSetJoinSettings();
  const [draft, setDraft] = useState<JoinDraft>(draftOf(saved));
  const set = (next: Partial<JoinDraft>) => setDraft((current) => ({ ...current, ...next }));
  const check = checkDomain(draft.domain);
  const submit = () => {
    const change = changeOf(draft);
    save.mutate(
      { data: change },
      {
        onSuccess: (response) => {
          if (response.status !== 200) {
            notify(problemText(response.data));
            return;
          }
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
        if (canSave(draft, saved)) submit();
      }}
    >
      <span className="pt-1.5 text-fg-dim">Logo</span>
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
          aria-label="Logo letters"
          value={draft.logo}
          maxLength={3}
          onChange={(event) => set({ logo: logoOf(event.target.value) })}
          className="w-20 font-mono uppercase"
        />
        <fieldset className="m-0 flex gap-1.5 border-0 p-0" aria-label="Logo colour">
          {logoColours.map((colour) => (
            <button
              key={colour}
              type="button"
              aria-label={`Logo colour ${colour}`}
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
      <span className="pt-1.5 text-fg-dim">Email domain</span>
      <div className="grid justify-items-start gap-1.5">
        <Input
          aria-label="Email domain"
          aria-invalid={check === "invalid" || check === "public"}
          aria-describedby="join-domain-help"
          placeholder="hospital.example"
          maxLength={253}
          value={draft.domain}
          onChange={(event) => set({ domain: event.target.value })}
          className="w-72"
        />
        <small
          id="join-domain-help"
          className={cn(
            "text-caption",
            check === "invalid" || check === "public" ? "text-bad" : "text-fg-dim",
          )}
        >
          {domainHelp[check]}
        </small>
      </div>
      <span className="pt-1.5 text-fg-dim">People from the domain</span>
      <div className="grid justify-items-start gap-1.5">
        <SegmentedControl
          aria-label="People from the domain"
          value={draft.policy}
          onValueChange={(value) => set({ policy: String(value) as JoinPolicy })}
          options={joinPolicyOptions.map((option) => ({ ...option }))}
        />
        <small className="text-caption text-fg-dim">
          {draft.policy === "join"
            ? "They join as reviewers without anyone saying yes."
            : "They ask, and someone with admin rights answers in Join requests on People."}
        </small>
      </div>
      <span />
      <div>
        <Button type="submit" variant="primary" disabled={!canSave(draft, saved) || save.isPending}>
          Apply
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
  const saved = okData(useGetJoinSettings().data);
  if (saved === undefined) return null;
  return (
    <Zone
      title="Logo and joining"
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
