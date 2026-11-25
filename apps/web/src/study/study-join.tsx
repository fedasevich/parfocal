import { Trans } from "@lingui/react/macro";
import { ApiError, useRedeemStudyLink } from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { freshRun, readRun, writeRun } from "./participant-run.ts";
import { joinToken } from "./study-links.ts";

type JoinState = "joining" | "gone" | "failed";

export function StudyJoin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const redeem = useRedeemStudyLink();
  const started = useRef(false);
  const [state, setState] = useState<JoinState>("joining");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = joinToken(window.location.hash);
    window.history.replaceState(null, "", window.location.pathname);
    const openStudy = () => {
      queryClient.clear();
      void navigate({ to: "/study" });
    };
    if (token === undefined) {
      if (readRun() !== undefined) openStudy();
      else setState("gone");
      return;
    }
    redeem.mutate(
      { data: { token } },
      {
        onSuccess: (response) => {
          const joined = okData(response);
          if (joined === undefined) {
            setState("failed");
            return;
          }
          const run = readRun();
          if (run?.code !== joined.code) writeRun(freshRun(joined.code));
          openStudy();
        },
        onError: (error) => {
          const refused = error instanceof ApiError && error.status === 410;
          if (refused && readRun() !== undefined) openStudy();
          else setState(refused ? "gone" : "failed");
        },
      },
    );
  }, [navigate, queryClient, redeem]);

  return (
    <main
      className="grid min-h-dvh place-items-center bg-surf-app p-6 text-fg"
      data-testid="study-join"
    >
      <section className="grid w-full max-w-xl gap-3 rounded-[14px] border border-line bg-surf-panel p-8 shadow-pop">
        <h1 className="text-title font-semibold">
          <Trans>Usability study</Trans>
        </h1>
        <p role="status" data-testid="study-join-status">
          {state === "joining" ? (
            <Trans>Opening your study session.</Trans>
          ) : state === "gone" ? (
            <Trans>
              This link was used already or has expired. Ask the moderator for a new one.
            </Trans>
          ) : (
            <Trans>The study could not open. Reload the page or ask the moderator.</Trans>
          )}
        </p>
      </section>
    </main>
  );
}
