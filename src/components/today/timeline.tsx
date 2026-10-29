import { Badge } from "@/components/ui/badge";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { TimelineItem } from "@/server/queries/today";

const KIND_LABEL: Partial<Record<TimelineItem["kind"], string>> = {
  run: "Run",
  training: "Gym",
  plan: "Plan",
};

const SOURCE_LABEL: Record<TimelineItem["source"], string> = {
  google: "Google",
  icloud: "iCloud",
  rules: "Rule",
};

function Row({ item, tz, now }: { item: TimelineItem; tz: string; now: Date }) {
  const past = item.end <= now;
  const current = item.start <= now && now < item.end;
  const kind = KIND_LABEL[item.kind];
  return (
    <li
      className={cn(
        "flex gap-4 border-l-2 py-2 pl-3",
        current ? "border-primary" : "border-transparent",
        past && "text-muted-foreground",
      )}
      style={item.color && !current ? { borderLeftColor: item.color } : undefined}
    >
      <div className="w-24 shrink-0 text-sm tabular-nums">
        {formatTime(item.start, tz)}–{formatTime(item.end, tz)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("font-medium", item.kind === "work" && "text-muted-foreground font-normal")}>
            {item.title}
          </span>
          {kind && <Badge variant="secondary">{kind}</Badge>}
          {current && <span className="sr-only">(now)</span>}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {SOURCE_LABEL[item.source]} · {item.calendarName}
          {item.location ? ` · ${item.location}` : ""}
        </div>
      </div>
    </li>
  );
}

export function Timeline({
  allDay,
  timed,
  tz,
  now,
}: {
  allDay: TimelineItem[];
  timed: TimelineItem[];
  tz: string;
  now: Date;
}) {
  return (
    <div className="space-y-3">
      {allDay.length > 0 && (
        <ul aria-label="All-day" className="flex flex-wrap gap-2">
          {allDay.map((i) => (
            <li key={i.id}>
              <Badge variant="outline" title={`${SOURCE_LABEL[i.source]} · ${i.calendarName}`}>
                {i.title}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <ol aria-label="Today's events">
        {timed.map((i) => (
          <Row key={i.id} item={i} tz={tz} now={now} />
        ))}
      </ol>
    </div>
  );
}
