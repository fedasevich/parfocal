import { useState } from "react";
import { formatNameOf } from "./format-name.ts";
import { slideThumbUrl } from "./slide-thumb-url.ts";

const STORAGE_KEY = "parfocal.missing-thumbs";

const rememberedMissing = (): Set<string> => {
  try {
    const stored: unknown = JSON.parse(globalThis.sessionStorage?.getItem(STORAGE_KEY) ?? "[]");
    return new Set(
      Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
};

const missingThumbs = rememberedMissing();

const remember = (slideId: string) => {
  missingThumbs.add(slideId);
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify([...missingThumbs]));
  } catch {
    return;
  }
};

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
        remember(slideId);
        setFailed(slideId);
      }}
      className={`object-cover ${className ?? ""}`}
    />
  );
}
