"use client";

import { RefreshCw } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { syncNowAction, type ActionState } from "@/server/actions/integrations";

export function SyncButton() {
  const [state, action, pending] = useActionState<ActionState>(syncNowAction, null);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <Button type="submit" variant="outline" size="xs" disabled={pending}>
        <RefreshCw aria-hidden />
        {pending ? "Syncing…" : "Sync now"}
      </Button>
      <span role="status" className={state && !state.ok ? "text-destructive" : undefined}>
        {!pending && state && !state.ok ? "Some sources failed" : null}
      </span>
    </form>
  );
}
