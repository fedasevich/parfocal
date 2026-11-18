import { useLingui } from "@lingui/react/macro";
import { TierPicker, TierPill } from "@parfocal/ui/components/viewer-tools";
import { useMemo, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const tiers = useMemo(() => oneClickTiers(hasWebGpu()), []);
  const chosen = tiers.find((item) => item.name === tierNames[shownTier(tier)]) ?? tiers[0];
  if (chosen === undefined) return null;
  return (
    <ContextExtra>
      <span data-testid="model-tier" data-tier={shownTier(tier)} className="relative inline-flex">
        <TierPill tier={chosen} open={open} onClick={() => setOpen(!open)} />
      </span>
      {open ? (
        <TierPicker
          data-testid="model-tier-picker"
          className="top-[calc(100%+8px)] left-1/2 -translate-x-1/2 text-left whitespace-normal"
          title={t`Model for outlining nuclei`}
          tiers={tiers}
          value={chosen.name}
          onValueChange={(name) => {
            const next = tierOfName(name);
            if (next !== null) onTierChange(next);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          note={t`The full model name shows when you point at a tier. Your lab decides which model each tier uses, and the report always records the exact model and version.`}
        />
      ) : null}
    </ContextExtra>
  );
}
