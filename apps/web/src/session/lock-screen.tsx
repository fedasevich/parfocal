import { useGetMe } from "@parfocal/api-client";
import { LockCard } from "@parfocal/ui/components/auth";
import { okData } from "../screens/placeholder.tsx";
import { personOf } from "../shell/global-shell.tsx";
import { reauthUrl } from "./lock-rules.ts";

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export default function LockScreen({
  minutes,
  reason,
}: {
  minutes: number;
  reason: "idle" | "manual";
}) {
  const me = okData(useGetMe().data);
  const unlock = () => window.location.assign(reauthUrl(currentPath()));
  const unlockWithPasskey = () => window.location.assign(reauthUrl(currentPath(), me?.email));
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
