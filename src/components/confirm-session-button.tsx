"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { confirmHabitAction } from "@/server/actions/logs";

export function ConfirmSessionButton({
  habit,
  eventId,
  dateKey,
  children = "Confirm",
}: {
  habit: "run" | "training";
  eventId: string | null;
  dateKey: string;
  children?: React.ReactNode;
}) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(() => confirmHabitAction(habit, eventId, dateKey))}>
      {pending ? "Saving…" : children}
    </Button>
  );
}
