import { Trans } from "@lingui/react/macro";
import { BrandMark } from "@parfocal/ui/components/brand-mark";
import { cn } from "@parfocal/ui/lib/utils";

type LoaderSize = "inline" | "block" | "page";

type LoaderProps = {
  label: string;
  size?: LoaderSize;
  still?: boolean;
  className?: string;
};

const glyphSize: Record<LoaderSize, string> = {
  inline: "size-4",
  block: "size-12",
  page: "size-16",
};

function Loader({ label, size = "block", still = false, className }: LoaderProps) {
  const body = (
    <span
      role="status"
      className={cn(
        "inline-flex items-center justify-center",
        size === "inline" ? "align-middle" : "w-full",
        className,
      )}
    >
      <BrandMark className={glyphSize[size]} breathing={!still} />
      {size === "page" ? (
        <span aria-hidden="true" className="ml-3 text-title font-semibold text-fg">
          <Trans>Parfocal</Trans>
        </span>
      ) : null}
      <span className="sr-only">{label}</span>
    </span>
  );
  if (size === "page") {
    return <main className="grid h-dvh place-items-center bg-page">{body}</main>;
  }
  return body;
}

export type { LoaderProps, LoaderSize };
export { Loader };
