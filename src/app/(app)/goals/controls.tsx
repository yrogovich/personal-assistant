"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addStepAction,
  applyStepsProposalAction,
  breakIntoStepsAction,
  dismissProposalAction,
  saveGoalAction,
  setStepStatusAction,
} from "@/server/actions/goals";
import type { ActionState } from "@/server/actions/integrations";

const selectClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border px-2 text-sm outline-none focus-visible:ring-3";

function Status({ state }: { state: ActionState }) {
  return (
    <p role="status" className={state?.ok === false ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
      {state?.message}
    </p>
  );
}

export type GoalFormValues = {
  id?: string;
  title: string;
  category: string;
  priority: string;
  why: string | null;
  targetDate: string | null;
  measure: string;
  status: string;
};

export function GoalForm({ goal, onDone }: { goal?: GoalFormValues; onDone?: () => void }) {
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const res = await saveGoalAction(prev, form);
    if (res?.ok) onDone?.();
    return res;
  }, null);
  const id = useId();
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {goal?.id && <input type="hidden" name="id" value={goal.id} />}
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${id}-title`}>Title</Label>
        <Input id={`${id}-title`} name="title" defaultValue={goal?.title} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-cat`}>Category</Label>
        <select id={`${id}-cat`} name="category" defaultValue={goal?.category ?? "personal"} className={selectClass}>
          <option value="fitness">Fitness &amp; health</option>
          <option value="work">Work</option>
          <option value="personal">Personal</option>
          <option value="relationship">Relationship</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-prio`}>Priority</Label>
        <select id={`${id}-prio`} name="priority" defaultValue={goal?.priority ?? "secondary"} className={selectClass}>
          <option value="main">Main</option>
          <option value="secondary">Secondary</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-measure`}>Measure</Label>
        <select id={`${id}-measure`} name="measure" defaultValue={goal?.measure ?? "steps"} className={selectClass}>
          <option value="steps">Steps</option>
          <option value="number">Number</option>
          <option value="habit">Habit</option>
          <option value="done">Done / not done</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-date`}>Target date</Label>
        <Input id={`${id}-date`} name="targetDate" type="date" defaultValue={goal?.targetDate ?? ""} />
      </div>
      {goal?.id && (
        <div className="space-y-1">
          <Label htmlFor={`${id}-status`}>Status</Label>
          <select id={`${id}-status`} name="status" defaultValue={goal.status} className={selectClass}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="done">Done</option>
            <option value="dropped">Dropped</option>
          </select>
        </div>
      )}
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${id}-why`}>Why</Label>
        <Input id={`${id}-why`} name="why" defaultValue={goal?.why ?? ""} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : goal?.id ? "Save to Notion" : "Add goal"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function EditGoal({ goal }: { goal: GoalFormValues }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="rounded-lg border p-3">
      <GoalForm goal={goal} onDone={() => setOpen(false)} />
      <Button size="xs" variant="ghost" className="mt-2" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  ) : (
    <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
      Edit goal
    </Button>
  );
}

const STATUS_LABEL = { todo: "To do", planned: "Planned", done: "Done", skipped: "Skipped" } as const;

export function StepStatusSelect({ stepId, status, title }: { stepId: string; status: keyof typeof STATUS_LABEL; title: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label={`Status of “${title}”`}
        defaultValue={status}
        disabled={pending}
        className={selectClass + " h-7 text-xs"}
        onChange={(e) =>
          start(async () => setState(await setStepStatusAction(stepId, e.target.value as keyof typeof STATUS_LABEL)))
        }
      >
        {Object.entries(STATUS_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {state?.ok === false && <Status state={state} />}
    </span>
  );
}

export function AddStepForm({ goalId }: { goalId: string }) {
  const [state, action, pending] = useActionState(addStepAction, null);
  const id = useId();
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="goalId" value={goalId} />
      <div className="min-w-48 flex-1 space-y-1">
        <Label htmlFor={`${id}-t`} className="text-xs">
          New step
        </Label>
        <Input id={`${id}-t`} name="title" required />
      </div>
      <div className="w-20 space-y-1">
        <Label htmlFor={`${id}-e`} className="text-xs">
          Minutes
        </Label>
        <Input id={`${id}-e`} name="estimateMin" type="number" min={5} max={480} step={5} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-d`} className="text-xs">
          Due
        </Label>
        <Input id={`${id}-d`} name="due" type="date" />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Adding…" : "Add step"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function BreakIntoSteps({ goalId, goalTitle, apiReady }: { goalId: string; goalTitle: string; apiReady: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  if (!apiReady) {
    return (
      <p className="text-muted-foreground text-xs">
        Break into steps: ask Claude Desktop “Break my goal ‘{goalTitle}’ into steps”. The proposal shows up here for you to pick from.
      </p>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="xs" variant="outline" disabled={pending} onClick={() => start(async () => setState(await breakIntoStepsAction(goalId)))}>
        {pending ? "Thinking…" : "Break into steps (AI)"}
      </Button>
      <Status state={state} />
    </span>
  );
}

export function StepsProposal({
  proposalId,
  steps,
  source,
}: {
  proposalId: number;
  steps: { title: string; estimate_min: number }[];
  source: "api" | "desktop";
}) {
  const [rows, setRows] = useState(steps.map((s) => ({ ...s, on: true })));
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <div className="text-sm font-medium">
        Proposed steps <span className="text-muted-foreground font-normal">({source === "desktop" ? "from Claude Desktop" : "from Claude"})</span>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label={`Include “${r.title}”`}
              checked={r.on}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
              className="accent-primary"
            />
            <Input
              aria-label="Step title"
              value={r.title}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
              className="h-7 flex-1 text-sm"
            />
            <span className="text-muted-foreground w-16 text-right text-xs tabular-nums">{r.estimate_min} min</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () =>
              setState(
                await applyStepsProposalAction(
                  proposalId,
                  rows.filter((r) => r.on).map(({ title, estimate_min }) => ({ title, estimate_min })),
                ),
              ),
            )
          }
        >
          {pending ? "Adding to Notion…" : `Add ${rows.filter((r) => r.on).length} to Notion`}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => setState(await dismissProposalAction(proposalId)))}>
          Dismiss
        </Button>
        <Status state={state} />
      </div>
    </div>
  );
}
