import type { Me } from "@parfocal/api-client";
import { LockCard } from "@parfocal/ui/components/auth";
import { personOf } from "../shell/global-shell.tsx";
import { reauthUrl } from "./lock-rules.ts";
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
  const unlockWithPasskey = () =>
    void startNamedLogin({ returnTo: currentPath(), loginHint: me.email, reauth: true });
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
