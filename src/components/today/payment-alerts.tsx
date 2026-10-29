"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { clearPaymentProblemAction, markPaymentDoneAction } from "@/server/actions/payments";
import type { PaymentAlert } from "@/server/payments";

const money = (amount: number | null, currency: string) =>
  amount === null ? null : new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(amount);

const day = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
};

function AlertRow({ a }: { a: PaymentAlert }) {
  const [pending, start] = useTransition();
  const amount = money(a.amount, a.currency);
  const when = a.kind === "failed" ? "payment failed" : a.kind === "overdue" ? `was due ${day(a.dueKey!)}` : `due ${day(a.dueKey!)}`;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm">
      <span className="font-medium">{a.name}</span>
      {amount && <span className="text-muted-foreground tabular-nums">{amount}</span>}
      <span className={a.kind === "due" ? "text-muted-foreground text-xs" : "text-destructive text-xs"}>{when}</span>
      {a.problem && <span className="text-muted-foreground w-full text-xs">“{a.problem}”</span>}
      <Button
        size="xs"
        variant="outline"
        className="ml-auto"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (a.kind === "failed") await clearPaymentProblemAction(a.id);
            else await markPaymentDoneAction(a.id, a.dueKey!);
          })
        }
      >
        {a.kind === "failed" ? "Sorted" : "Done"}
      </Button>
    </li>
  );
}

export function PaymentAlerts({ alerts }: { alerts: PaymentAlert[] }) {
  return (
    <ul className="divide-y">
      {alerts.map((a) => (
        <AlertRow key={`${a.id}:${a.dueKey ?? a.kind}`} a={a} />
      ))}
    </ul>
  );
}
