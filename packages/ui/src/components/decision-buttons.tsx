import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type DecisionStyle = "certainty" | "agree" | "yesno" | "blind";

type CountsAs = "agree" | "disagree" | "unsure";

type DecisionAnswer = {
  raw: string;
  label: string;
  key: string;
  action?: string | undefined;
  countsAs?: CountsAs | undefined;
  color?: string | undefined;
};

type ProjectClass = { name: string; color: string; id?: string | undefined };

const certaintyLabels = ["Certainly not", "Probably not", "Can't tell", "Probably", "Certainly"];

function answersFor(
  style: DecisionStyle,
  classes: ProjectClass[] = [],
  aiClass?: string,
  range: { agreeFrom: number; disagreeTo: number } = { agreeFrom: 4, disagreeTo: 2 },
): DecisionAnswer[] {
  const notSure: DecisionAnswer = {
    raw: "unsure",
    label: "Not sure",
    key: "U",
    action: "dunsure",
    countsAs: "unsure",
  };
  if (style === "certainty") {
    return certaintyLabels.map((label, index) => {
      const value = index + 1;
      const countsAs: CountsAs =
        value >= range.agreeFrom ? "agree" : value <= range.disagreeTo ? "disagree" : "unsure";
      return { raw: String(value), label, key: String(value), action: `dcert:${value}`, countsAs };
    });
  }
  if (style === "agree") {
    return [
      { raw: "agree", label: "Agree", key: "K", action: "dagree", countsAs: "agree" },
      { raw: "disagree", label: "Disagree", key: "X", action: "ddisagree", countsAs: "disagree" },
      notSure,
    ];
  }
  if (style === "yesno") {
    return [
      { raw: "yes", label: "Yes", key: "Y", action: "dyes" },
      { raw: "no", label: "No", key: "N", action: "dno" },
      notSure,
    ];
  }
  return [
    ...classes.map((projectClass, index) => ({
      raw: projectClass.name,
      label: projectClass.name,
      key: String(index + 1),
      action: `dclass:${index + 1}`,
      color: projectClass.color,
      countsAs:
        aiClass === undefined
          ? undefined
          : projectClass.name === aiClass
            ? ("agree" as const)
            : ("disagree" as const),
    })),
    notSure,
  ];
}

const toneIcon: Record<CountsAs, IconName> = {
  agree: "check",
  disagree: "x-circle",
  unsure: "help",
};

const toneColor: Record<CountsAs, string> = {
  agree: "text-ok",
  disagree: "text-bad",
  unsure: "text-warn",
};

function AnswerMark({ style, answer }: { style: DecisionStyle; answer: DecisionAnswer }) {
  if (style === "blind" && answer.color) {
    return (
      <i
        aria-hidden="true"
        className="inline-block size-3.5 rounded-[3px]"
        style={{ background: answer.color }}
      />
    );
  }
  if (style === "yesno") {
    const name: IconName = answer.raw === "yes" ? "check" : answer.raw === "no" ? "close" : "help";
    return <Icon name={name} size="md" className="text-fg-dim" />;
  }
  const tone = answer.countsAs ?? "unsure";
  return <Icon name={toneIcon[tone]} size="md" className={toneColor[tone]} />;
}

type DecisionButtonsProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  decisionStyle: DecisionStyle;
  size?: "large" | "compact";
  value?: string | undefined;
  onValueChange?: ((raw: string) => void) | undefined;
  classes?: ProjectClass[];
  aiClass?: string;
  range?: { agreeFrom: number; disagreeTo: number };
  disabled?: boolean;
  label?: string;
};

function DecisionButtons({
  decisionStyle,
  size = "large",
  value,
  onValueChange,
  classes,
  aiClass,
  range,
  disabled = false,
  label = "Your answer",
  className,
  ...props
}: DecisionButtonsProps) {
  const answers = answersFor(decisionStyle, classes, aiClass, range);
  const many = answers.length > 3;
  return (
    <div
      data-slot="decision-buttons"
      data-style={decisionStyle}
      data-size={size}
      role="group"
      aria-label={label}
      className={cn(
        size === "large" ? cn("grid", many ? "gap-2" : "gap-2.5") : "flex flex-wrap gap-1.5",
        className,
      )}
      {...props}
    >
      {answers.map((answer) => {
        const selected = value === answer.raw;
        return (
          <button
            key={answer.raw}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            data-counts-as={answer.countsAs}
            onClick={() => onValueChange?.(answer.raw)}
            className={cn(
              "cursor-pointer border-line-strong bg-chrome-2 text-left text-fg outline-none hover:not-disabled:border-accent hover:not-disabled:bg-accent-soft focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:disabled:opacity-100",
              size === "large"
                ? cn(
                    "grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-zone border-[1.5px] px-4.5 font-semibold",
                    many ? "h-11.5 rounded-[10px] text-lead" : "h-14.5 text-title-sm",
                  )
                : "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-ctl border px-2 text-body-sm font-medium",
            )}
          >
            <AnswerMark style={decisionStyle} answer={answer} />
            <span className="min-w-0 truncate">{answer.label}</span>
            <Keycap
              action={answer.action}
              keys={answer.key}
              size={size === "large" ? "lg" : "sm"}
            />
          </button>
        );
      })}
    </div>
  );
}

export {
  answersFor,
  type CountsAs,
  type DecisionAnswer,
  DecisionButtons,
  type DecisionButtonsProps,
  type DecisionStyle,
  type ProjectClass,
};
