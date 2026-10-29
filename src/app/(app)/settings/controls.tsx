"use client";

import { useActionState, useId, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  connectAnthropicAction,
  connectHevyAction,
  connectRemindersAction,
  connectIcloudAction,
  connectNotionAction,
  retryNotionSetupAction,
  disconnectAction,
  saveKeywordsAction,
  setCalendarIncludedAction,
  setCalendarRoleAction,
  setFeedEnabledAction,
  type ActionState,
} from "@/server/actions/integrations";
import type { Feed, Provider } from "@/server/db/schema";

function Status({ state }: { state: ActionState }) {
  return (
    <p role="status" className={state?.ok === false ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>
      {state?.message}
    </p>
  );
}

export function DisconnectButton({ provider, label }: { provider: Provider; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (confirm(`Disconnect ${label}? Its cached data is removed from the dashboard. Nothing is deleted at ${label}.`)) {
          start(() => disconnectAction(provider));
        }
      }}
    >
      {pending ? "Disconnecting…" : "Disconnect"}
    </Button>
  );
}

export function FeedSwitch({ feed, label, enabled }: { feed: Feed; label: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Switch
      aria-label={`Sync ${label}`}
      checked={enabled}
      disabled={pending}
      onCheckedChange={(v) => start(() => setFeedEnabledAction(feed, v))}
    />
  );
}

export function CalendarRow(props: {
  id: string;
  name: string;
  color: string | null;
  included: boolean;
  role: "normal" | "plan" | "training";
}) {
  const [pending, start] = useTransition();
  const switchId = useId();
  return (
    <div className="flex items-center gap-3">
      <Switch
        id={switchId}
        checked={props.included}
        disabled={pending}
        onCheckedChange={(v) => start(() => setCalendarIncludedAction(props.id, v))}
      />
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: props.color ?? "currentColor" }} />
      <Label htmlFor={switchId} className="min-w-0 flex-1 truncate font-normal">
        {props.name}
        {props.role === "plan" && <span className="text-muted-foreground"> (AI plan blocks)</span>}
      </Label>
      {props.role !== "plan" && (
        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            className="accent-primary"
            checked={props.role === "training"}
            disabled={pending}
            onChange={(e) => start(() => setCalendarRoleAction(props.id, e.target.checked ? "training" : "normal"))}
          />
          Training
        </label>
      )}
    </div>
  );
}

export function IcloudForm() {
  const [state, action, pending] = useActionState(connectIcloudAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="appleId">Apple ID</Label>
        <Input id="appleId" name="appleId" type="email" autoComplete="username" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="appPassword">App-specific password</Label>
        <Input
          id="appPassword"
          name="appPassword"
          type="password"
          autoComplete="off"
          placeholder="abcd-efgh-ijkl-mnop"
          required
        />
        <p className="text-muted-foreground text-xs">
          Create one at account.apple.com → Sign-In and Security → App-Specific Passwords. Stored encrypted on this Mac.
        </p>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Checking…" : "Connect iCloud"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function KeywordsForm({ run, training }: { run: string; training: string }) {
  const [state, action, pending] = useActionState(saveKeywordsAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="kw-run">Run keywords</Label>
        <Input id="kw-run" name="run" defaultValue={run} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="kw-training">Gym keywords</Label>
        <Input id="kw-training" name="training" defaultValue={training} />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save keywords"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function NotionForm() {
  const [state, action, pending] = useActionState(connectNotionAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="notion-token">Internal Integration Secret</Label>
        <Input id="notion-token" name="token" type="password" autoComplete="off" placeholder="ntn_…" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notion-page">Link to your Dashboard page</Label>
        <Input id="notion-page" name="page" type="url" placeholder="https://www.notion.so/Dashboard-…" required />
        <p className="text-muted-foreground text-xs">
          Share that page with the integration first (••• → Connections). Goals, Steps, Books and Reviews databases are
          created inside it and seeded with your goals once. This takes about half a minute.
        </p>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Setting up Notion…" : "Connect Notion"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function NotionRetryButton() {
  const [state, action, pending] = useActionState<ActionState>(retryNotionSetupAction, null);
  return (
    <form action={action} className="space-y-2">
      <p className="text-sm">The databases aren&apos;t set up yet.</p>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Setting up…" : "Finish Notion setup"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function HevyForm() {
  const [state, action, pending] = useActionState(connectHevyAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="hevy-key">API key</Label>
        <Input id="hevy-key" name="apiKey" type="password" autoComplete="off" required />
        <p className="text-muted-foreground text-xs">Hevy app → Settings → Developer (Hevy Pro). Stored encrypted on this Mac.</p>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Checking…" : "Connect Hevy"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function AnthropicForm() {
  const [state, action, pending] = useActionState(connectAnthropicAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="anthropic-key">API key</Label>
        <Input id="anthropic-key" name="apiKey" type="password" autoComplete="off" placeholder="sk-ant-…" required />
        <p className="text-muted-foreground text-xs">From platform.claude.com → API keys. Stored encrypted on this Mac.</p>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Checking…" : "Save key"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function RemindersConnect() {
  const [state, action, pending] = useActionState<ActionState>(connectRemindersAction, null);
  return (
    <form action={action} className="space-y-2">
      <p className="text-muted-foreground text-xs">
        macOS will ask to let the app running the dashboard (Terminal, iTerm, or your editor) control Reminders. Allow it.
      </p>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Reading Reminders…" : "Connect Reminders"}
      </Button>
      <Status state={state} />
    </form>
  );
}
