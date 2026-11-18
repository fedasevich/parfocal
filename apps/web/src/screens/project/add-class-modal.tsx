import { useLingui } from "@lingui/react/macro";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useState } from "react";
import { classErrors, type NewClass } from "./model.ts";

const swatches = [
  { colour: "#f59e0b", name: "Amber" },
  { colour: "#10b981", name: "Green" },
  { colour: "#8b5cf6", name: "Violet" },
  { colour: "#64748b", name: "Slate" },
];

export function AddClassModal({
  open,
  projectCode,
  taken,
  onClose,
  onAdd,
}: {
  open: boolean;
  projectCode: string;
  taken: Pick<NewClass, "name" | "key">[];
  onClose: () => void;
  onAdd: (item: NewClass) => void;
}) {
  const { t } = useLingui();

  const [name, setName] = useState("");
  const [colour, setColour] = useState(swatches[0]?.colour ?? "#f59e0b");
  const [key, setKey] = useState("");
  const [tried, setTried] = useState(false);
  const errors = classErrors(name, key, taken);
  const blockers = Object.entries(errors).map(([field, text]) => ({
    id: field,
    text,
    goTo: field === "name" ? t`Go to Name` : t`Go to Key`,
  }));
  const reset = () => {
    setName("");
    setKey("");
    setTried(false);
  };
  return (
    <SmallModal
      open={open}
      dirty={name !== "" || key !== ""}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
      title={t`Add a class`}
      subtitle={t`To ${projectCode}. New imports and tasks can use it.`}
      width={480}
      hint={t`Classes from imports can map to it later.`}
      primaryLabel={t`Add class`}
      blockers={tried ? blockers : []}
      blockersTitle={t`Before you can add the class`}
      onPrimary={() => {
        setTried(true);
        if (blockers.length > 0) return;
        onAdd({ name: name.trim(), colour, key: Number(key.trim()) });
        reset();
      }}
    >
      <FormField label={t`Name`} error={tried ? errors.name : undefined}>
        <TextFieldInput
          value={name}
          maxLength={40}
          placeholder={t`For example Necrosis`}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </FormField>
      <FormField label={t`Color`}>
        <SegmentedControl
          aria-label={t`Color`}
          value={colour}
          onValueChange={(value) => setColour(String(value))}
          options={swatches.map((swatch) => ({
            value: swatch.colour,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px]" style={{ background: swatch.colour }} />
                {swatch.name}
              </span>
            ),
          }))}
        />
      </FormField>
      <FormField
        label={t`Key`}
        error={tried ? errors.key : undefined}
        help={t`A number from 1 to 9. Reviewers press it to give a cell this class.`}
      >
        <TextFieldInput
          value={key}
          maxLength={1}
          inputMode="numeric"
          className="w-16 font-mono"
          onChange={(event) => setKey(event.currentTarget.value)}
        />
      </FormField>
    </SmallModal>
  );
}
