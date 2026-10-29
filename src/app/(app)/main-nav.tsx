"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/today", label: "Today" },
  { href: "/week", label: "Week" },
  { href: "/month", label: "Month" },
  { href: "/goals", label: "Goals" },
  { href: "/review", label: "Review" },
  { href: "/settings", label: "Settings" },
] as const;

export function MainNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      <ul className="flex gap-1 overflow-x-auto">
        {LINKS.map((l) => {
          const active = pathname.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring/50 rounded-md px-3 py-1.5 text-sm outline-none focus-visible:ring-3",
                  active ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
