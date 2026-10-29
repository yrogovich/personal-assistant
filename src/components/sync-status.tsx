import { formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import type { FeedStatus } from "@/server/queries/integrations";
import { SyncButton } from "./sync-button";

function line(f: FeedStatus): { text: string; problem: boolean } {
  if (!f.connected) return { text: "not connected", problem: false };
  if (f.connectionError) return { text: "reconnect needed", problem: true };
  if (!f.enabled) return { text: "off", problem: false };
  if (f.lastError) return { text: "last sync failed", problem: true };
  if (!f.lastSyncedAt) return { text: "not synced yet", problem: false };
  return { text: `synced ${formatDistanceToNowStrict(f.lastSyncedAt, { addSuffix: true })}`, problem: false };
}

/** "Last synced" per source, plus Sync now. */
export function SyncStatus({ feeds }: { feeds: FeedStatus[] }) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {feeds.map((f) => {
        const { text, problem } = line(f);
        return (
          <span key={f.key} title={f.lastError ?? f.connectionError ?? undefined}>
            {f.label}:{" "}
            {problem ? (
              <Link href="/settings" className="text-destructive underline underline-offset-2">
                {text}
              </Link>
            ) : (
              text
            )}
          </span>
        );
      })}
      <SyncButton />
    </div>
  );
}
