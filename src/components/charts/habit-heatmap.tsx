import { cn } from "@/lib/utils";

// Habits × days. One hue: filled = done, muted = not. A real table, so it reads row by row with a
// screen reader; each cell has a hover tooltip (title) with the date and state.

type Row = { label: string; total: number; cells: { date: string; done: boolean }[] };

const dayNum = (d: string) => Number(d.slice(8, 10));

export function HabitHeatmap({ rows }: { rows: Row[] }) {
  const days = rows[0]?.cells.map((c) => c.date) ?? [];
  if (days.length === 0) return <p className="text-muted-foreground text-sm">No days yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[2px] text-xs">
        <caption className="sr-only">Habit days this month</caption>
        <thead>
          <tr>
            <th scope="col" className="sr-only">
              Habit
            </th>
            {days.map((d) => (
              <th key={d} scope="col" className="text-muted-foreground w-4 font-normal tabular-nums">
                {dayNum(d) === 1 || dayNum(d) % 5 === 0 ? dayNum(d) : <span className="sr-only">{dayNum(d)}</span>}
              </th>
            ))}
            <th scope="col" className="text-muted-foreground pl-2 text-left font-normal">
              Days
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="pr-2 text-left font-normal whitespace-nowrap">
                {r.label}
              </th>
              {r.cells.map((c) => (
                <td key={c.date} className="p-0">
                  <span
                    title={`${r.label} · ${c.date}: ${c.done ? "done" : "—"}`}
                    className={cn("block size-4 rounded-[3px]", c.done ? "bg-foreground" : "bg-muted")}
                  >
                    <span className="sr-only">{c.done ? "done" : "not done"}</span>
                  </span>
                </td>
              ))}
              <td className="pl-2 tabular-nums">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
