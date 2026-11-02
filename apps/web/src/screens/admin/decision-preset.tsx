import { CountsAsLine } from "@parfocal/ui/components/counts-as";
import type { DecisionStyle } from "@parfocal/ui/components/decision-buttons";
import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";

export type DecisionPreset = { style: DecisionStyle; agreeFrom: number; disagreeTo: number };

const choices: { style: DecisionStyle; name: string; detail: string }[] = [
  {
    style: "certainty",
    name: "5-point certainty",
    detail: "The AI's claim, then how sure the reviewer is, from 1 Certainly not to 5 Certainly.",
  },
  {
    style: "agree",
    name: "Agree with the AI",
    detail: "The AI's claim, then Agree, Disagree or Not sure.",
  },
  {
    style: "yesno",
    name: "Yes or no",
    detail: "One question for every object. The AI's claim stays hidden.",
  },
  {
    style: "blind",
    name: "Pick the class blind",
    detail: "The reviewer picks the class without seeing the AI's, then Parfocal compares.",
  },
];

export function DecisionPresetPicker({
  value,
  onChange,
}: {
  value: DecisionPreset;
  onChange: (next: DecisionPreset) => void;
}) {
  return (
    <div className="grid gap-2" data-slot="decision-preset">
      <span id="preset-decision" className="text-body-sm font-semibold">
        Decision question
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
                <b className="block font-medium">{choice.name}</b>
                <small className="text-caption text-fg-dim">{choice.detail}</small>
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
