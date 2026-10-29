import "server-only";
import { APIErrorCode, Client, isNotionClientError, type PageObjectResponse } from "@notionhq/client";
import { AuthRevokedError, getCredentials, NotConnectedError } from "../store";

export type NotionCredentials = { token: string; parentPageId: string };

export async function notionClient(): Promise<{ notion: Client; creds: NotionCredentials }> {
  const creds = await getCredentials<NotionCredentials>("notion");
  if (!creds) throw new NotConnectedError("notion");
  return { notion: new Client({ auth: creds.token }), creds };
}

/** Maps "token revoked / page not shared" to AuthRevokedError so the UI asks to reconnect. */
export function rethrowNotionError(err: unknown): never {
  if (isNotionClientError(err) && err.code === APIErrorCode.Unauthorized) {
    throw new AuthRevokedError("Notion rejected the integration token. Reconnect Notion in Settings.");
  }
  if (isNotionClientError(err) && err.code === APIErrorCode.ObjectNotFound) {
    throw new AuthRevokedError("Notion can't see the Dashboard page or its databases. Share the page with the integration.");
  }
  throw err;
}

// Property readers. Notion returns a union per property; these pick the value we expect or null.
type Props = PageObjectResponse["properties"];
type Prop = Props[string];

const plain = (rich: { plain_text: string }[]) => rich.map((r) => r.plain_text).join("").trim();

export function readTitle(props: Props, name: string): string {
  const p: Prop | undefined = props[name];
  return p?.type === "title" ? plain(p.title) : "";
}
export function readText(props: Props, name: string): string | null {
  const p = props[name];
  return p?.type === "rich_text" ? plain(p.rich_text) || null : null;
}
export function readSelect(props: Props, name: string): string | null {
  const p = props[name];
  return p?.type === "select" ? (p.select?.name ?? null) : null;
}
export function readNumber(props: Props, name: string): number | null {
  const p = props[name];
  return p?.type === "number" ? p.number : null;
}
/** Date property start as "YYYY-MM-DD" (time part dropped). */
export function readDate(props: Props, name: string): string | null {
  const p = props[name];
  return p?.type === "date" && p.date ? p.date.start.slice(0, 10) : null;
}
export function readRelation(props: Props, name: string): string[] {
  const p = props[name];
  return p?.type === "relation" ? p.relation.map((r) => r.id) : [];
}

// Property writers (request shapes).
export const write = {
  title: (content: string) => ({ title: [{ text: { content } }] }),
  text: (content: string | null) => ({ rich_text: content ? [{ text: { content } }] : [] }),
  select: (name: string | null) => ({ select: name ? { name } : null }),
  number: (n: number | null) => ({ number: n }),
  date: (start: string | null, end?: string | null) => ({ date: start ? { start, end: end ?? null } : null }),
  relation: (ids: string[]) => ({ relation: ids.map((id) => ({ id })) }),
};
