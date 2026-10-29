"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/server/actions/integrations";
import {
  approveBlockAction,
  ensureTodayPlanAction,
  markStepDoneAction,
  removeBlockAction,
  replanAction,
  setFreeAtWorkAction,
  skipBlockAction,
} from "@/server/actions/plan";

function Status({ state }: { state: ActionState }) {
  return (
    <p role="status" className={state?.ok === false ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
      {state?.message}
    </p>
  );
}

/** First open of the day without a plan: generate one (the 06:30 run didn't happen). */
export function AutoPlan() {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<ActionState>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ensureTodayPlanAction().then((s) => {
      setState(s);
      if (s?.ok) router.refresh();
    });
  }, [router]);
  return (
    <p role="status" className={state?.ok === false ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>
      {state?.ok === false ? `Couldn't plan today: ${state.message}` : "Planning your day… this takes up to a minute."}
    </p>
  );
}

export function ReplanButton() {
  const [state, action, pending] = useActionState<ActionState>(replanAction, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Replanning…" : "Replan"}
      </Button>
      {!pending && state && !state.ok && <Status state={state} />}
    </form>
  );
}

export type BlockView = {
  id: number;
  title: string;
  reason: string | null;
  kind: string;
  status: "proposed" | "approved" | "skipped" | "superseded";
  start: string; // "HH:mm" local
  end: string;
};

const KIND_LABEL: Record<string, string> = { step: "Step", run: "Run", training: "Gym", reading: "Reading", other: "Other" };

export function BlockRow({ block }: { block: BlockView }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(block.title);
  const [start, setStart] = useState(block.start);
  const [end, setEnd] = useState(block.end);
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionState>) => startTransition(async () => setState(await fn()));

  return (
    <li className={cn("space-y-2 py-3", block.status === "skipped" && "text-muted-foreground")}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="w-24 shrink-0 text-sm tabular-nums">
          {block.start}–{block.end}
        </span>
        <span className={cn("font-medium", block.status === "skipped" && "line-through")}>{block.title}</span>
        <Badge variant="secondary">{KIND_LABEL[block.kind] ?? block.kind}</Badge>
        {block.status === "approved" && <Badge variant="outline">On your calendar</Badge>}
        {block.status === "skipped" && <span className="text-xs">skipped</span>}
      </div>
      {block.reason && block.status === "proposed" && <p className="text-muted-foreground text-xs sm:pl-27">{block.reason}</p>}

      {block.status === "proposed" && !editing && (
        <div className="flex gap-2 sm:pl-27">
          <Button size="sm" disabled={pending} onClick={() => run(() => approveBlockAction(block.id))}>
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => skipBlockAction(block.id))}>
            Skip
          </Button>
        </div>
      )}

      {block.status === "proposed" && editing && (
        <form
          className="flex flex-wrap items-end gap-2 sm:pl-27"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => approveBlockAction(block.id, { title, start, end }));
          }}
        >
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor={`t-${block.id}`} className="text-xs">
              Title
            </Label>
            <Input id={`t-${block.id}`} value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`s-${block.id}`} className="text-xs">
              Start
            </Label>
            <Input id={`s-${block.id}`} type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`e-${block.id}`} className="text-xs">
              End
            </Label>
            <Input id={`e-${block.id}`} type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            Save and approve
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      )}

      {block.status === "approved" && (
        <div className="sm:pl-27">
          <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => removeBlockAction(block.id))}>
            Remove from calendar
          </Button>
        </div>
      )}
      <div className="sm:pl-27">
        <Status state={state} />
      </div>
    </li>
  );
}

export function StepDoneButton({ stepId }: { stepId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  return (
    <>
      <Button size="xs" variant="outline" disabled={pending} onClick={() => start(async () => setState(await markStepDoneAction(stepId)))}>
        {pending ? "Saving…" : "Done"}
      </Button>
      {state?.ok === false && <Status state={state} />}
    </>
  );
}

export function FreeAtWorkForm({ current }: { current: { start: string; end: string } | null }) {
  const [state, action, pending] = useActionState(setFreeAtWorkAction, null);
  return (
    <form action={action} className="space-y-2">
      <div className="text-sm font-medium">Free time at work today</div>
      <p className="text-muted-foreground text-xs">Only learning steps (courses, certifications) are planned in this window.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="faw-start" className="sr-only">
          From
        </Label>
        <Input id="faw-start" name="start" type="time" defaultValue={current?.start ?? "13:00"} className="w-28" />
        <span aria-hidden>–</span>
        <Label htmlFor="faw-end" className="sr-only">
          To
        </Label>
        <Input id="faw-end" name="end" type="time" defaultValue={current?.end ?? "14:00"} className="w-28" />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Save
        </Button>
        {current && (
          <Button type="submit" name="clear" value="1" size="sm" variant="ghost" disabled={pending}>
            Clear
          </Button>
        )}
      </div>
      <Status state={state} />
    </form>
  );
}
