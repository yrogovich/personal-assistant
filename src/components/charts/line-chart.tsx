"use client";

import { useId, useState } from "react";

// Single-series line chart: no legend (the title names it), 2px line, ≥8px markers,
// crosshair + tooltip on hover/focus, recessive axes, text in text tokens, no animation.

export type Point = { label: string; value: number; detail?: string };

export function LineChart({
  points,
  unit,
  height = 140,
  compact = false,
  ariaLabel,
}: {
  points: Point[];
  unit: string;
  height?: number;
  compact?: boolean;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const width = compact ? 220 : 560;
  const pad = compact ? { t: 8, r: 8, b: 8, l: 8 } : { t: 12, r: 12, b: 22, l: 40 };
  if (points.length === 0) return <p className="text-muted-foreground text-sm">No data yet.</p>;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lo = min - span * 0.15;
  const hi = max + span * 0.15;
  const x = (i: number) => pad.l + (points.length === 1 ? (width - pad.l - pad.r) / 2 : (i * (width - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const a = active === null ? null : points[active];

  const pick = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    setActive(best);
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none overflow-visible"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive(points.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? points.length - 1) - 1));
          if (e.key === "ArrowRight") setActive((i) => Math.min(points.length - 1, (i ?? 0) + 1));
        }}
      >
        {!compact && (
          <g className="text-muted-foreground" fontSize="10" fill="currentColor">
            {[max, min].map((v, i) => (
              <g key={i}>
                <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
                <text x={pad.l - 6} y={y(v)} dy="0.32em" textAnchor="end">
                  {Math.round(v * 10) / 10}
                </text>
              </g>
            ))}
            <text x={x(0)} y={height - 4} textAnchor="start">
              {points[0].label}
            </text>
            {points.length > 1 && (
              <text x={x(points.length - 1)} y={height - 4} textAnchor="end">
                {points.at(-1)!.label}
              </text>
            )}
          </g>
        )}
        {a && active !== null && <line x1={x(active)} x2={x(active)} y1={pad.t} y2={height - pad.b} className="stroke-muted-foreground" strokeWidth={1} />}
        <path d={path} fill="none" className="stroke-foreground" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.value)}
            r={active === i ? 5 : 4}
            className={active === i ? "fill-foreground stroke-background" : "fill-background stroke-foreground"}
            strokeWidth={2}
          />
        ))}
      </svg>
      {a && active !== null && (
        <div
          role="status"
          id={`${id}-tip`}
          className="bg-popover text-popover-foreground pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-sm"
          style={{ left: `${(x(active) / width) * 100}%` }}
        >
          <span className="font-medium tabular-nums">
            {a.value} {unit}
          </span>{" "}
          <span className="text-muted-foreground">
            · {a.label}
            {a.detail ? ` · ${a.detail}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

/** The table view that every chart offers. */
export function DataTable({ points, unit, caption }: { points: Point[]; unit: string; caption: string }) {
  if (points.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="text-muted-foreground cursor-pointer">Show data</summary>
      <table className="mt-2 w-full text-left tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-muted-foreground">
          <tr>
            <th className="font-normal">Date</th>
            <th className="font-normal">Value</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{p.label}</td>
              <td>
                {p.value} {unit}
                {p.detail ? ` (${p.detail})` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
