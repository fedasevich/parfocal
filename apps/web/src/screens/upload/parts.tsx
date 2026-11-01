import type { LinkRenderer } from "@parfocal/ui/components/app-shell";
import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function useCrumbLink(): LinkRenderer {
  const router = useRouter();
  return ({ href, children, ...props }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        void router.navigate({ href });
      }}
    >
      {children}
    </a>
  );
}

export function Thumb({ className }: { className?: string }) {
  return (
    <i
      aria-hidden="true"
      className={cn(
        "h-7 w-10 flex-none rounded-sm border border-line bg-cover bg-center",
        className,
      )}
      style={{ backgroundImage: "url(/mock-assets/overview.jpg)" }}
    />
  );
}

export function FileIcon() {
  return (
    <span className="grid w-10 place-items-center text-fg-faint">
      <Icon name="file" />
    </span>
  );
}

export function FileName({ name, detail }: { name: ReactNode; detail: ReactNode }) {
  return (
    <span className="grid min-w-0 gap-0.5">
      <b className="truncate font-mono text-body-sm font-medium text-fg">{name}</b>
      <small className="truncate text-caption text-fg-faint">{detail}</small>
    </span>
  );
}

export function FileRow({
  lead,
  name,
  detail,
  end,
}: {
  lead: ReactNode;
  name: ReactNode;
  detail: ReactNode;
  end?: ReactNode;
}) {
  return (
    <div className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-line py-1.5 pr-2 pl-3 [&+&]:border-t">
      {lead}
      <FileName name={name} detail={detail} />
      {end}
    </div>
  );
}

export function FileList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid min-w-0 overflow-hidden rounded-[10px] border border-surf-edge bg-surf-panel",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TextLink({
  onClick,
  children,
  className,
}: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer border-0 bg-transparent p-0 text-body-sm font-medium text-accent hover:underline",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function CheckRow({ tone, children }: { tone: "ok" | "warn"; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2.5 text-body-sm leading-[1.45] text-fg">
      <Icon
        name={tone === "ok" ? "check" : "warn"}
        className={cn("mt-0.5", tone === "ok" ? "text-ok" : "text-warn")}
      />
      <span>{children}</span>
    </div>
  );
}

export function SlideOverlay({
  kind,
  height = 160,
}: {
  kind: "off" | "heat" | "regions";
  height?: number;
}) {
  const width = Math.round(height * 1.45);
  return (
    <span
      aria-hidden="true"
      className="relative block overflow-hidden rounded-md border border-line bg-white"
      style={{ height, width }}
    >
      <span
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/mock-assets/overview.jpg)" }}
      />
      {kind === "regions" ? (
        <span className="absolute inset-[22%_30%_28%_24%] rounded-[40%] border-2 border-dashed border-[#22d3ee] bg-[rgb(34_211_238/0.18)]" />
      ) : (
        <span
          className={cn(
            "absolute bg-cover bg-center opacity-80",
            kind === "off" ? "top-0 left-0 h-1/4 w-1/4" : "inset-0 opacity-70",
          )}
          style={{ backgroundImage: "url(/mock-assets/tumor-heat.png)" }}
        />
      )}
    </span>
  );
}
