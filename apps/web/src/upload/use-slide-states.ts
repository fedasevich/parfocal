import {
  getGetUploadStatusQueryOptions,
  IngestStatus,
  type UploadState,
} from "@parfocal/api-client";
import { useQueries } from "@tanstack/react-query";

const settled: string[] = [IngestStatus.ready, IngestStatus.failed, IngestStatus.skipped];

export function useSlideStates(
  uploadIds: readonly string[],
  intervalMs = 2_000,
): Record<string, UploadState | undefined> {
  const results = useQueries({
    queries: uploadIds.map((uploadId) =>
      getGetUploadStatusQueryOptions(uploadId, {
        query: {
          refetchInterval: (query) => {
            const body = query.state.data;
            return body?.status === 200 && settled.includes(body.data.status) ? false : intervalMs;
          },
        },
      }),
    ),
  });
  const states: Record<string, UploadState | undefined> = {};
  uploadIds.forEach((uploadId, index) => {
    const body = results[index]?.data;
    states[uploadId] = body?.status === 200 ? body.data : undefined;
  });
  return states;
}
