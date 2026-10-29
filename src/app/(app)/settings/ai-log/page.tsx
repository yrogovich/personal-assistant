import { desc } from "drizzle-orm";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { aiDecision, aiRun } from "@/server/db/schema";
import { env } from "@/server/env";

export const metadata = { title: "AI log · Dashboard" };

/** Everything the AI was sent and proposed, and what you decided. */
export default async function AiLogPage() {
  await requireUser();
  const tz = env().APP_TIMEZONE;
  const [runs, decisions] = await Promise.all([
    db().query.aiRun.findMany({ orderBy: desc(aiRun.id), limit: 50 }),
    db().query.aiDecision.findMany({ orderBy: desc(aiDecision.id), limit: 500 }),
  ]);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/settings" className="text-muted-foreground text-sm underline-offset-2 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold">AI log</h1>
        <p className="text-muted-foreground text-sm">The last 50 AI calls: what was sent, what came back, and your decisions.</p>
      </div>
      {runs.length === 0 && <p className="text-muted-foreground text-sm">No AI calls yet.</p>}
      {runs.map((r) => {
        const mine = decisions.filter((d) => d.aiRunId === r.id);
        return (
          <Card key={r.id}>
            <CardHeader>
              <CardTitle>
                <h2 className="flex flex-wrap items-center gap-2">
                  {r.job.replace("_", " ")} <Badge variant="secondary">{r.model}</Badge>
                  {r.error && <Badge variant="destructive">failed</Badge>}
                </h2>
              </CardTitle>
              <p className="text-muted-foreground text-xs">
                {fmt.format(r.createdAt)}
                {r.inputTokens !== null && ` · ${r.inputTokens} in / ${r.outputTokens} out tokens`}
              </p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {r.error && <p className="text-destructive">{r.error}</p>}
              {mine.length > 0 && (
                <ul className="space-y-0.5">
                  {mine.map((d) => (
                    <li key={d.id}>
                      <Badge variant="outline">{d.decision}</Badge>{" "}
                      {(d.before as { title?: string } | null)?.title ?? d.item}
                      {d.after ? ` → ${(d.after as { title?: string }).title ?? "edited"}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <details>
                <summary className="cursor-pointer">Sent to the model</summary>
                <pre className="bg-muted mt-2 max-h-80 overflow-auto rounded p-3 text-xs whitespace-pre-wrap">
                  {JSON.stringify(r.input, null, 2)}
                </pre>
              </details>
              {r.output !== null && (
                <details>
                  <summary className="cursor-pointer">Model output</summary>
                  <pre className="bg-muted mt-2 max-h-80 overflow-auto rounded p-3 text-xs whitespace-pre-wrap">
                    {JSON.stringify(r.output, null, 2)}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
