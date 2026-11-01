import { useListTenantMembers } from "@parfocal/api-client";
import { Icon } from "@parfocal/ui/components/icon";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { Textarea } from "@parfocal/ui/components/textarea";
import { TokenField } from "@parfocal/ui/components/token-field";
import { useState } from "react";
import { closeOn } from "../clinical-report/modals.tsx";
import { andJoin } from "../format.ts";
import { FieldNote } from "../new-task/parts.tsx";
import { toPersonInfo } from "../people.ts";
import { okData } from "../placeholder.tsx";

export function SendToAdjudicatorModal({
  labels,
  taskCode,
  excluded,
  onClose,
  onSend,
}: {
  labels: string[];
  taskCode: string;
  excluded: string[];
  onClose: () => void;
  onSend: (adjudicatorId: string, note: string | null) => void;
}) {
  const members = okData(useListTenantMembers().data) ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const error = tried && picked === null ? "Pick who decides." : undefined;
  const items = members
    .filter((member) => member.role === "reviewer")
    .map((member) => {
      const blocked = excluded.includes(member.user_id);
      return {
        id: member.user_id,
        name: member.display_name,
        person: toPersonInfo(member),
        ...(member.title ? { sub: member.title } : {}),
        ...(blocked ? { dim: `A reviewer of ${taskCode}` } : {}),
      };
    });
  const count = labels.length;
  return (
    <SmallModal
      open
      onOpenChange={closeOn(onClose)}
      title="Send to an adjudicator"
      subtitle={`${andJoin(labels)} · ${taskCode}`}
      hint={picked === null ? "Pick who decides." : "They see it in My work."}
      primaryLabel={`Send ${count} object${count === 1 ? "" : "s"}`}
      onPrimary={() => {
        setTried(true);
        if (picked === null) {
          document.getElementById("adjudicator-who")?.querySelector("input")?.focus();
          return;
        }
        onSend(picked, note.trim() || null);
      }}
    >
      <div className="grid gap-1.5">
        <span id="adjudicator-who-label" className="text-body-sm font-semibold">
          Who decides
        </span>
        <TokenField
          id="adjudicator-who"
          aria-labelledby="adjudicator-who-label"
          label="Who decides"
          single
          placeholder="Type a name"
          items={items}
          picked={picked ? [picked] : []}
          invalid={Boolean(error)}
          onPickedChange={(ids) => setPicked(ids.find((id) => !excluded.includes(id)) ?? null)}
        />
        <FieldNote error={error} />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="adjudicator-note" className="text-body-sm font-semibold">
          Note to them <span className="font-normal text-fg-dim">optional</span>
        </label>
        <Textarea
          id="adjudicator-note"
          rows={3}
          maxLength={300}
          placeholder="For example, the CK slide is in the case"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <FieldNote count={`${note.length} of 300`} />
      </div>
      <p className="m-0 flex items-start gap-2 text-body-sm text-fg">
        <Icon name="shield" className="mt-0.5 text-fg-dim" />
        Reviewers stay anonymous. The adjudicator sees Reviewer A and Reviewer B.
      </p>
    </SmallModal>
  );
}
