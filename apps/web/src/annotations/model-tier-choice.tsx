import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { oneClickTiers, shownTier, tierNames, tierOfName } from "../aiseg/one-click-tiers.ts";
import type { OutlineTier } from "../aiseg/prompt-fallback.ts";
import { ContextExtra } from "./context-extras.tsx";

type ModelTierChoiceProps = {
  tier: OutlineTier;
  onTierChange: (tier: OutlineTier) => void;
};

const hasWebGpu = () => typeof navigator !== "undefined" && "gpu" in navigator;

export function ModelTierChoice({ tier, onTierChange }: ModelTierChoiceProps) {
  const { t } = useLingui();
  const tiers = useMemo(() => [...oneClickTiers(hasWebGpu())].reverse(), []);
  const shown = shownTier(tier);
  return (
    <ContextExtra>
      <fieldset
        aria-label={t`Model for outlining nuclei`}
        data-testid="model-tier"
        data-tier={shown}
        className="m-0 inline-flex min-w-0 items-stretch gap-0.5 rounded-ctl border-0 bg-seg-track p-0.5"
      >
        {tiers.map((item) => {
          const value = tierOfName(item.name);
          if (value === null) return null;
          const pressed = shown === value;
          return (
            <button
              key={item.name}
              type="button"
              aria-pressed={pressed}
              data-testid={`model-tier-${value}`}
              title={`${item.description} ${item.model}`}
              className="inline-flex min-h-6.5 cursor-pointer items-center rounded-md border-0 bg-transparent px-3 text-caption font-medium whitespace-nowrap text-fg-dim outline-none hover:not-aria-pressed:text-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent aria-pressed:bg-accent-soft aria-pressed:font-semibold aria-pressed:text-fg aria-pressed:shadow-[inset_0_0_0_1.5px_var(--accent)]"
              onClick={() => {
                if (!pressed) onTierChange(value);
              }}
            >
              {tierNames[value]}
            </button>
          );
        })}
      </fieldset>
    </ContextExtra>
  );
}
