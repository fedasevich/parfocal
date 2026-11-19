import { Tooltip, TooltipContent } from "@parfocal/ui/components/tooltip";
import { useEffect, useState } from "react";

export const tipAttribute = "data-tip";
const tipDelayMs = 350;

type Tip = { readonly text: string; readonly anchor: Element };

export function moveTitleToTip(node: Element): void {
  const text = node.getAttribute("title");
  if (text === null) return;
  node.removeAttribute("title");
  if (text === "") return;
  node.setAttribute(tipAttribute, text);
  if (node.hasAttribute("aria-label") || node.hasAttribute("aria-labelledby")) return;
  if ((node.textContent ?? "").trim() === "") node.setAttribute("aria-label", text);
  else if (!node.hasAttribute("aria-description")) node.setAttribute("aria-description", text);
}

export function moveTitlesIn(root: Element): void {
  if (root.hasAttribute("title")) moveTitleToTip(root);
  for (const node of root.querySelectorAll("[title]")) moveTitleToTip(node);
}

export function StageTips({ stage }: { stage: HTMLElement | null }) {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    if (!stage) return;
    moveTitlesIn(stage);
    const watch = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof Element) {
          moveTitleToTip(record.target);
        }
        for (const added of record.addedNodes) {
          if (added instanceof Element) moveTitlesIn(added);
        }
      }
    });
    watch.observe(stage, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["title"],
    });
    let timer: number | undefined;
    const clear = () => {
      window.clearTimeout(timer);
      setTip(null);
    };
    const show = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest(`[${tipAttribute}]`) ?? null;
      window.clearTimeout(timer);
      if (!anchor) {
        setTip(null);
        return;
      }
      const text = anchor.getAttribute(tipAttribute) ?? "";
      const delay = event.type === "focusin" ? 0 : tipDelayMs;
      timer = window.setTimeout(() => setTip({ text, anchor }), delay);
    };
    stage.addEventListener("pointerover", show);
    stage.addEventListener("focusin", show);
    stage.addEventListener("pointerleave", clear);
    stage.addEventListener("focusout", clear);
    stage.addEventListener("pointerdown", clear);
    stage.addEventListener("wheel", clear, { passive: true });
    return () => {
      watch.disconnect();
      window.clearTimeout(timer);
      stage.removeEventListener("pointerover", show);
      stage.removeEventListener("focusin", show);
      stage.removeEventListener("pointerleave", clear);
      stage.removeEventListener("focusout", clear);
      stage.removeEventListener("pointerdown", clear);
      stage.removeEventListener("wheel", clear);
    };
  }, [stage]);

  return (
    <Tooltip open={tip !== null}>
      {tip ? (
        <TooltipContent anchor={tip.anchor} data-testid="stage-tip">
          {tip.text}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}
