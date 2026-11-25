import { useLingui } from "@lingui/react/macro";
import { ModelPicker } from "@parfocal/ui/components/model-picker";
import { useMemo, useState } from "react";
import { shownTier, tierChoices } from "../aiseg/one-click-tiers.ts";
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
  const shown = shownTier(tier);
  const groups = useMemo(
    () => [
      {
        title: t`Outline models`,
        options: tierChoices(hasWebGpu()).map((choice) => ({
          id: choice.tier,
          title: choice.title,
          description: choice.description,
          makes: choice.makes,
          perSlide: choice.cost,
        })),
      },
    ],
    [t],
  );
  return (
    <ContextExtra>
      <ModelPicker
        compact
        label={t`Model for outlining nuclei`}
        groups={groups}
        value={shown}
        open={open}
        onOpenChange={setOpen}
        onValueChange={(id) => {
          if (id !== shown) onTierChange(id === "best" ? "best" : "good");
        }}
        triggerProps={{ "data-testid": "model-tier", "data-tier": shown }}
      />
    </ContextExtra>
  );
}
