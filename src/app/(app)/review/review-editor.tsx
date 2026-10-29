"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/server/actions/integrations";
import { confirmReviewAction, draftReviewAction } from "@/server/actions/review";

const textareaClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border px-2.5 py-2 text-sm outline-none focus-visible:ring-3";

export function ReviewEditor({
  type,
  draft,
  notes,
  source,
  apiReady,
}: {
  type: "daily" | "weekly";
  draft: string | null;
  notes: string | null;
  source: "api" | "desktop" | "manual" | null;
  apiReady: boolean;
}) {
  const id = useId();
  const [noteText, setNoteText] = useState(notes ?? "");
  const [text, setText] = useState(draft ?? "");
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`${id}-notes`}>{type === "daily" ? "Anything to add about today?" : "Anything to add about this week?"}</Label>
        <textarea
          id={`${id}-notes`}
          rows={2}
          className={textareaClass}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder={type === "daily" ? "Energy, what blocked you, a win…" : "What felt good, what got in the way…"}
        />
      </div>
      {apiReady ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await draftReviewAction(type, noteText);
              setState(res);
            })
          }
        >
          {pending ? "Drafting…" : draft ? "Redraft with Claude" : "Draft with Claude"}
        </Button>
      ) : (
        <p className="text-muted-foreground text-xs">
          Ask Claude Desktop “Draft my {type === "daily" ? "evening check-in" : "weekly review"}”. The draft appears here (reload). Or
          write it yourself below.
        </p>
      )}
      <div className="space-y-1">
        <Label htmlFor={`${id}-text`}>
          {type === "daily" ? "Check-in" : "Review"}
          {draft && source && source !== "manual" && (
            <span className="text-muted-foreground font-normal"> · AI draft ({source === "desktop" ? "Claude Desktop" : "Claude"}), edit freely</span>
          )}
        </Label>
        <textarea
          id={`${id}-text`}
          rows={type === "daily" ? 6 : 12}
          className={textareaClass + " font-mono"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={pending || !text.trim()} onClick={() => start(async () => setState(await confirmReviewAction(type, text)))}>
          Confirm and save to Notion
        </Button>
        <p role="status" className={state?.ok === false ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
          {state?.message}
        </p>
      </div>
    </div>
  );
}
