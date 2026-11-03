import type { ReactNode } from "react";

export function SideCard({
  title,
  end,
  children,
}: {
  title: string;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-3 rounded-xl border border-line bg-chrome p-4">
      <div className="flex items-center justify-between">
        <b className="text-body font-semibold text-fg">{title}</b>
        {end}
      </div>
      {children}
    </section>
  );
}

export function DotRow({
  colour,
  title,
  sub,
  onClick,
}: {
  colour: string;
  title: string;
  sub: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <i aria-hidden="true" className="mt-1.5 size-2 rounded-full" style={{ background: colour }} />
      <span className="text-left">
        <span className="text-fg">{title}</span>
        <small className="mt-0.5 block text-caption text-fg-faint">{sub}</small>
      </span>
    </>
  );
  const layout = "grid grid-cols-[8px_minmax(0,1fr)] items-start gap-3 text-body-sm";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${layout} cursor-pointer border-0 bg-transparent p-0`}
    >
      {body}
    </button>
  ) : (
    <div className={layout}>{body}</div>
  );
}
