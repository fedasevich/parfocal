export type OpenFailure = {
  readonly title: string;
  readonly detail: string;
};

const generic: OpenFailure = {
  title: "This slide could not be opened",
  detail: "Try again. If it keeps failing, tell your administrator.",
};

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

export function describeOpenFailure(error: unknown): OpenFailure {
  const name = nameOf(error);
  if (name === "GpuUnrecoverableError" && error instanceof Error) {
    const message = (error as { userMessage?: unknown }).userMessage;
    return {
      title: "The graphics card stopped drawing",
      detail: typeof message === "string" ? message : generic.detail,
    };
  }
  if (name === "UnsupportedFormatError") {
    return {
      title: "This file format cannot be opened in the browser yet",
      detail: "The original is stored safely. It will open once the format is supported.",
    };
  }
  if (name === "SlideNeedsReingestError") {
    return {
      title: "This slide needs re-ingest",
      detail:
        "The saved positions of its camera frames are missing, so tissue would show twice. The original is stored safely. Upload it again or ask your administrator to re-ingest it.",
    };
  }
  if (name === "SlideHasSeveralScanAreasError") {
    return {
      title: "This slide holds several scan areas, which Parfocal cannot place yet",
      detail: "The original is stored safely. It will open once several scan areas are supported.",
    };
  }
  const status = statusOf(error);
  if (name === "ApiError" || name === "SlideBytesError") {
    if (status === 404) {
      return {
        title: "The slide file is not available",
        detail: "It may still be processing, or it was removed.",
      };
    }
    if (status === 401 || status === 403) {
      return {
        title: "You cannot open this slide",
        detail: "Your access to it may have changed. Ask the project owner.",
      };
    }
    if (status === 503) {
      return {
        title: "Slide access is not switched on here yet",
        detail: "Try again later.",
      };
    }
  }
  return generic;
}
