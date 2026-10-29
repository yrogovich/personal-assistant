import { cn } from "@/lib/utils";

/** Static progress ring (no animation). Full at `target`; a bonus up to `max` shows as text. */
export function HabitRing({
  label,
  done,
  target,
  max,
  unit,
  emptyText,
}: {
  label: string;
  done: number;
  target: number;
  max?: number;
  unit: string;
  emptyText?: string;
}) {
  const size = 96;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = target > 0 ? Math.min(1, done / target) : 0;
  const complete = target > 0 && done >= target;
  const summary = target > 0 ? `${done} of ${target}${max && max > target ? `–${max}` : ""} ${unit}` : (emptyText ?? "No target");

  return (
    <figure className="flex flex-col items-center gap-2" aria-label={`${label}: ${summary}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - ratio)}
            className={cn(complete ? "stroke-primary" : "stroke-foreground/60")}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-tight" aria-hidden>
          <span className="text-xl font-semibold tabular-nums">{target > 0 ? done : "–"}</span>
          {target > 0 && <span className="text-muted-foreground text-xs tabular-nums">/ {target}</span>}
        </div>
      </div>
      <figcaption className="text-center text-sm">
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground text-xs">{target > 0 ? unit : (emptyText ?? "")}</div>
      </figcaption>
    </figure>
  );
}
