"use client";

import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/server/actions/integrations";
import {
  addBookAction,
  confirmHabitAction,
  logReadingAction,
  logReelAction,
  logWeightAction,
  undoLastReelAction,
} from "@/server/actions/logs";

function Status({ state }: { state: ActionState }) {
  return (
    <p role="status" className={state?.ok === false ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
      {state?.message}
    </p>
  );
}

export function ReadingLog({
  book,
}: {
  book: { id: string; title: string; currentPage: number; totalPages: number | null } | null;
}) {
  const [state, action, pending] = useActionState(logReadingAction, null);
  const [addState, addAction, adding] = useActionState(addBookAction, null);

  if (!book) {
    return (
      <form action={addAction} className="space-y-2">
        <div className="text-sm font-medium">Start a book</div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor="book-title" className="text-xs">
              Title
            </Label>
            <Input id="book-title" name="title" required />
          </div>
          <div className="w-24 space-y-1">
            <Label htmlFor="book-pages" className="text-xs">
              Pages
            </Label>
            <Input id="book-pages" name="totalPages" type="number" inputMode="numeric" min={1} required />
          </div>
          <Button type="submit" size="sm" disabled={adding}>
            {adding ? "Adding…" : "Add"}
          </Button>
        </div>
        <Status state={addState} />
      </form>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="bookId" value={book.id} />
      <Label htmlFor="reading-page" className="text-sm font-medium">
        Reading “{book.title}”
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="reading-page"
          name="page"
          type="number"
          inputMode="numeric"
          min={0}
          max={book.totalPages ?? undefined}
          defaultValue={book.currentPage || undefined}
          className="w-24"
          required
        />
        <span className="text-muted-foreground text-sm">{book.totalPages ? `of ${book.totalPages}` : "page"}</span>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save page"}
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function ReelLog({ count }: { count: number }) {
  const [state, action, pending] = useActionState<ActionState>(logReelAction, null);
  const [undoState, undo, undoing] = useActionState<ActionState>(undoLastReelAction, null);
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">
        Reels this week: <span className="tabular-nums">{count}</span> / 2–3
      </div>
      <div className="flex gap-2">
        <form action={action}>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Reel posted today
          </Button>
        </form>
        <form action={undo}>
          <Button type="submit" size="sm" variant="ghost" disabled={undoing || count === 0}>
            Undo
          </Button>
        </form>
      </div>
      <Status state={undoState ?? state} />
    </div>
  );
}

export function GymLog({
  todayKey,
  recordedToday,
  confirmedToday,
  eventId,
}: {
  todayKey: string;
  recordedToday: boolean;
  confirmedToday: boolean;
  eventId: string | null;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Gym today</div>
      {recordedToday ? (
        <p className="text-muted-foreground text-sm">Recorded by Hevy.</p>
      ) : confirmedToday ? (
        <p className="text-muted-foreground text-sm">Confirmed by hand.</p>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => start(() => confirmHabitAction("training", eventId, todayKey))}
        >
          {pending ? "Saving…" : "I went to the gym (Hevy missed it)"}
        </Button>
      )}
    </div>
  );
}

export function WeighIn({ lastKg }: { lastKg: number | null }) {
  const [state, action, pending] = useActionState(logWeightAction, null);
  return (
    <form action={action} className="space-y-2">
      <Label htmlFor="weight-kg" className="text-sm font-medium">
        Weekly weigh-in
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="weight-kg"
          name="kg"
          inputMode="decimal"
          placeholder={lastKg ? String(lastKg) : "74.0"}
          className="w-24"
          required
        />
        <span className="text-muted-foreground text-sm">kg</span>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}
