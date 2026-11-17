import type { Me } from "@parfocal/api-client";
import { LockCard } from "@parfocal/ui/components/auth";
import { personOf } from "../shell/global-shell.tsx";
import { reauthUrl } from "./lock-rules.ts";
import { PasskeyCancelledError, passkeysSupported, signInWithPasskey } from "./passkeys.ts";
import { startNamedLogin } from "./sign-in-redirect.ts";

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export default function LockScreen({
  me,
  minutes,
  reason,
}: {
  me: Me;
  minutes: number;
  reason: "idle" | "manual";
}) {
  const unlock = () => window.location.assign(reauthUrl(currentPath()));
  const unlockWithHostedLogin = () =>
    void startNamedLogin({ returnTo: currentPath(), loginHint: me.email, reauth: true });
  const unlockWithPasskey = () => {
    if (!passkeysSupported() || !me.email) {
      unlockWithHostedLogin();
      return;
    }
    signInWithPasskey({ email: me.email, returnTo: currentPath() }).then(
      (landing) => window.location.assign(landing.return_to),
      (error: unknown) => {
        if (!(error instanceof PasskeyCancelledError)) unlockWithHostedLogin();
      },
    );
  };
  return (
    <div className="fixed inset-0 z-[1000]">
      <LockCard
        person={personOf(me)}
        minutes={minutes}
        reason={reason}
        onUnlock={unlock}
        onPasskey={unlockWithPasskey}
        onLogOut={() => window.location.assign("/api/auth/logout")}
      />
    </div>
  );
}
