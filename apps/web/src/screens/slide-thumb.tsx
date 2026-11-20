import { useState } from "react";
import { formatNameOf } from "./format-name.ts";
import { slideThumbUrl } from "./slide-thumb-url.ts";

const missingThumbs = new Set<string>();

export function SlideThumb({
  slideId,
  file,
  className,
}: {
  slideId: string;
  file: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === slideId || missingThumbs.has(slideId)) {
    return (
      <span
        aria-hidden="true"
        data-testid="slide-thumb-fallback"
        className={`grid place-content-center bg-surf-section font-mono text-caption text-fg-faint ${className ?? ""}`}
      >
        {formatNameOf(file)}
      </span>
    );
  }
  return (
    <img
      alt=""
      aria-hidden="true"
      data-testid="slide-thumb"
      src={slideThumbUrl(slideId)}
      loading="lazy"
      draggable={false}
      onError={() => {
        missingThumbs.add(slideId);
        setFailed(slideId);
      }}
      className={`object-cover ${className ?? ""}`}
    />
  );
}
