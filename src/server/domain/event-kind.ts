import type { EventKind } from "../db/schema";
import type { EventKeywords } from "../settings";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Keyword matches at the start of a word ("run" matches "Run club", not "brunch"). */
function matchesAny(title: string, keywords: string[]): boolean {
  return keywords.some((kw) => kw.trim() && new RegExp(`(^|[^\\p{L}])${escape(kw.trim())}`, "iu").test(title));
}

export function classifyEvent(
  title: string,
  calendarRole: "normal" | "plan" | "training",
  keywords: EventKeywords,
): EventKind {
  if (calendarRole === "plan") return "plan";
  if (matchesAny(title, keywords.run)) return "run";
  if (calendarRole === "training" || matchesAny(title, keywords.training)) return "training";
  return "other";
}
