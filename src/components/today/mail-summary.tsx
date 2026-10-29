import { formatTime } from "@/lib/time";
import type { getMail } from "@/server/queries/plan";

type Mail = Awaited<ReturnType<typeof getMail>>;
type Thread = Mail["needsReply"][number];

const senderName = (s: string) => s.replace(/<.*>/, "").replace(/"/g, "").trim() || s;

function ThreadRow({ t, tz }: { t: Thread; tz: string }) {
  return (
    <li className="space-y-0.5 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{senderName(t.sender)}</span>
        <span className="text-muted-foreground text-xs">
          {t.source === "gmail" ? "Gmail" : "iCloud"} · {formatTime(t.receivedAt, tz)}
        </span>
      </div>
      <div className="text-sm">
        {t.url ? (
          <a href={t.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
            {t.subject}
          </a>
        ) : (
          t.subject
        )}
      </div>
      {t.summary && <div className="text-muted-foreground text-xs">{t.summary}</div>}
    </li>
  );
}

function Group({ title, threads, tz, open }: { title: string; threads: Thread[]; tz: string; open?: boolean }) {
  if (threads.length === 0) return null;
  return (
    <details open={open} className="group">
      <summary className="cursor-pointer text-sm font-medium">
        {title} <span className="text-muted-foreground tabular-nums">({threads.length})</span>
      </summary>
      <ul className="divide-y pl-4">
        {threads.map((t) => (
          <ThreadRow key={t.id} t={t} tz={tz} />
        ))}
      </ul>
    </details>
  );
}

export function MailSummary({ mail, tz }: { mail: Mail; tz: string }) {
  const total = mail.needsReply.length + mail.fyi.length + mail.ignore.length + mail.unsorted.length;
  if (total === 0) return <p className="text-muted-foreground text-sm">Inbox zero on unread mail.</p>;
  return (
    <div className="space-y-3">
      <Group title="Needs reply" threads={mail.needsReply} tz={tz} open />
      <Group title="FYI" threads={mail.fyi} tz={tz} />
      <Group title="Ignore" threads={mail.ignore} tz={tz} />
      <Group title="Not sorted yet" threads={mail.unsorted} tz={tz} />
    </div>
  );
}
