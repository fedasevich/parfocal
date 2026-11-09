import { Input } from "@parfocal/ui/components/input";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useState } from "react";
import { presetProblem } from "./preset-name.ts";

type SavePresetModalProps = {
  open: boolean;
  slideLabel: string;
  taskCode: string;
  taken: string[];
  onClose: () => void;
  onSave: (name: string, scope: "task" | "all") => Promise<"saved" | "taken" | "failed">;
};

export function SavePresetModal({
  open,
  slideLabel,
  taskCode,
  taken,
  onClose,
  onSave,
}: SavePresetModalProps) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"task" | "all">("task");
  const [tried, setTried] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const problem = presetProblem(name, taken) ?? refused;
  const submit = () => {
    setTried(true);
    if (problem !== null) return;
    void onSave(name.trim(), scope).then((status) => {
      if (status === "taken") setRefused(`You already have a preset called ${name.trim()}.`);
      else if (status === "failed") setRefused("The preset was not saved. Try again.");
    });
  };
  const shiftKey = taken.length + 2;
  return (
    <SmallModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Save a preset"
      subtitle={`The display settings you have now, on ${slideLabel} in ${taskCode}`}
      hint={shiftKey <= 4 ? `Shift+${shiftKey} switches to it.` : "Pick it from the presets menu."}
      primaryLabel="Save"
      onPrimary={submit}
    >
      <div className="grid gap-1.5">
        <label htmlFor="preset-name" className="text-caption font-semibold text-fg-dim">
          Name
        </label>
        <Input
          id="preset-name"
          autoFocus
          value={name}
          maxLength={40}
          placeholder="For example, Fill by score"
          aria-invalid={tried && problem !== null ? true : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setRefused(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        {tried && problem ? <small className="text-caption text-bad">{problem}</small> : null}
      </div>
      <div className="grid gap-1.5">
        <span id="preset-scope" className="text-caption font-semibold text-fg-dim">
          Use for
        </span>
        <SegmentedControl
          aria-labelledby="preset-scope"
          value={scope}
          onValueChange={(next) => setScope(next === "all" ? "all" : "task")}
          options={[
            { value: "task", label: "Only this task" },
            { value: "all", label: "All my tasks" },
          ]}
        />
      </div>
    </SmallModal>
  );
}
