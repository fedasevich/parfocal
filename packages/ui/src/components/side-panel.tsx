import { TabCount, Tabs, TabsContent, TabsList, TabsTrigger } from "@parfocal/ui/components/tabs";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type SidePanelTab = {
  value: string;
  label: string;
  count?: number;
  body: React.ReactNode;
  foot?: React.ReactNode;
};

type SidePanelProps = Omit<React.ComponentProps<"aside">, "defaultValue"> & {
  tabs: SidePanelTab[];
  defaultTab?: string;
  value?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  width?: number;
  variant?: "panel" | "quiet";
  head?: React.ReactNode;
};

function SidePanel({
  tabs,
  defaultTab,
  value,
  onValueChange,
  width = 340,
  variant = "panel",
  head,
  className,
  ...props
}: SidePanelProps) {
  return (
    <aside
      data-slot="side-panel"
      aria-label="Side panel"
      className={cn("flex min-h-0 flex-col border-l border-line bg-chrome", className)}
      style={{ width }}
      {...props}
    >
      {head}
      <Tabs
        {...(value === undefined ? { defaultValue: defaultTab ?? tabs[0]?.value } : { value })}
        onValueChange={(next) => onValueChange?.(String(next))}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList variant={variant}>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
              {tab.count ? <TabCount>{tab.count}</TabCount> : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-5.5 overflow-auto p-5">{tab.body}</div>
            {tab.foot ? (
              <div className="grid gap-2.5 border-t border-line bg-chrome px-5 pt-3.5 pb-4.5">
                {tab.foot}
              </div>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  );
}

export { SidePanel, type SidePanelProps, type SidePanelTab };
