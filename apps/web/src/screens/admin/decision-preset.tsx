import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { CountsAsLine } from "@parfocal/ui/components/counts-as";
import type { DecisionStyle } from "@parfocal/ui/components/decision-buttons";
import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";

export type DecisionPreset = { style: DecisionStyle; agreeFrom: number; disagreeTo: number };

const choices: { style: DecisionStyle; name: MessageDescriptor; detail: MessageDescriptor }[] = [
  {
    style: "certainty",
    name: msg`5-point certainty`,
    detail: msg`The AI's claim, then how sure the reviewer is, from 1 Certainly not to 5 Certainly.`,
  },
  {
    style: "agree",
    name: msg`Agree with the AI`,
    detail: msg`The AI's claim, then Agree, Disagree or Not sure.`,
  },
  {
    style: "yesno",
    name: msg`Yes or no`,
    detail: msg`One question for every object. The AI's claim stays hidden.`,
  },
  {
    style: "blind",
    name: msg`Pick the class blind`,
    detail: msg`The reviewer picks the class without seeing the AI's, then Parfocal compares.`,
  },
];

export function DecisionPresetPicker({
  value,
  onChange,
}: {
  value: DecisionPreset;
  onChange: (next: DecisionPreset) => void;
}) {
  const { t } = useLingui();

  return (
    <div className="grid gap-2" data-slot="decision-preset">
      <span id="preset-decision" className="text-body-sm font-semibold">
        <Trans>Decision question</Trans>
      </span>
      <RadioGroup
        aria-labelledby="preset-decision"
        value={value.style}
        onValueChange={(style) =>
          onChange({ style: style as DecisionStyle, agreeFrom: 4, disagreeTo: 2 })
        }
        className="grid gap-2"
      >
        {choices.map((choice) => (
          <div key={choice.style} className="grid gap-1">
            <label className="flex cursor-pointer items-start gap-2.5 text-body-sm">
              <RadioGroupItem value={choice.style} className="mt-0.5" />
              <span>
                <b className="block font-medium">{t(choice.name)}</b>
                <small className="text-caption text-fg-dim">{t(choice.detail)}</small>
              </span>
            </label>
            {value.style === choice.style ? (
              <CountsAsLine
                className="ml-6.25"
                decisionStyle={choice.style}
                agreeFrom={value.agreeFrom}
                disagreeTo={value.disagreeTo}
                onRangeChange={(range) => onChange({ ...value, ...range })}
              />
            ) : null}
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
