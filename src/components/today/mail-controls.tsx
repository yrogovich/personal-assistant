"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/server/actions/integrations";
import { dismissStarAction, starThreadAction } from "@/server/actions/mail";

/** Claude suggested starring this thread; nothing happens in Gmail until you press Star. */
export function StarSuggestion({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="xs" variant="outline" disabled={pending} onClick={() => start(async () => setState(await starThreadAction(id)))}>
        ☆ Star
      </Button>
      <Button
        size="xs"
        variant="ghost"
        aria-label="Don't star"
        disabled={pending}
        onClick={() => start(async () => setState(await dismissStarAction(id)))}
      >
        ×
      </Button>
      {state?.ok === false && <span className="text-destructive text-xs">{state.message}</span>}
    </span>
  );
}
