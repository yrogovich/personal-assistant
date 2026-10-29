# Mail sorting and monthly payments

> Decisions dated 2026-10-29.

## Goal

Keep the inbox sorted and catch money problems early, without adding another list to look at every day.

## Mail sorting

**Folders.** New Gmail threads go into four existing Gmail labels. The mapping is the `mailLabels` setting, and a label that doesn't exist yet is created.

| Folder | Gmail label | What goes there |
|---|---|---|
| security | Security Notifications | Sign-in alerts, login and verification codes, account security changes |
| money | Bills & Transactions | Bills, invoices, receipts, payments, bank and tax mail, failed payments |
| orders | Orders & Delivery | Shop orders, couriers, deliveries |
| newsletters | Newsletters & App Updates | Newsletters, marketing, product updates |

**How a folder is picked.**
1. **Sender rules first** (`mailRules` setting): a thread whose sender contains `from` (and whose subject contains `subject`, if set) gets that rule's folder. This covers regular senders such as Autopay, inFakt, Stripe and couriers. It's cheap, predictable and works without AI.
2. **Claude for the rest**, in the same call that sorts mail into needs reply / FYI / ignore. Claude may leave the folder empty.

**What the app may do in Gmail** (scope `gmail.modify`):
- Add the folder label. The thread stays in the inbox; nothing is archived or marked read.
- Add a star, **only when you press Star** on Today. Claude only suggests stars, for the few threads that really matter.
- Never send, delete or archive mail, and never remove labels.

**Today.** Each mail row shows its folder. Star suggestions get **☆ Star** and **×** buttons. A suggested thread that doesn't need a reply (for example a failed payment) appears under **Worth a look**, so it isn't hidden in a collapsed group.

**Older connections.** A Google connection made with `gmail.readonly` keeps working read-only until you press **Reconnect** in Settings.

**Scope of sorting.** Only what the app already syncs: unread inbox threads from the last 3 days (up to 30). Older mail isn't touched.

## Monthly payments

**Data.** One row per payment: name, amount (optional), currency, day of the month, paid automatically or by me, and "mail from" (part of the sender or subject of its mail). You edit the list in Settings.

**Starter list.** These were found in Gmail; amounts and some days still need checking:

| Payment | Day | Paid | Mail from |
|---|---|---|---|
| inFakt (accounting) | 8 | automatically | infakt.pl |
| Vectra (internet) | 9 | automatically | vectra |
| Claude Pro | 23 | automatically | anthropic |
| Send invoice to Adchitects | 3 | by me | |
| ZUS contributions | 20 | by me | |
| VAT | 25 | by me | |
| MultiSport | 10 (guess) | by me | |

**Keeping it calm.** Nothing shows on a normal day.
- **Paid by me:** appears on Today from 3 days before its day until you press **Done** for that month. If you miss the day, it shows as overdue.
- **Paid automatically:** appears only when synced mail matching "mail from" says the payment failed (Polish or English wording). **Sorted** hides it; a newer failure brings it back.
- **Month:** one line with the number of payments and the known monthly total. The full list is behind "Show all".
- **Morning brief:** gets the names and due dates of payments that need you (no amounts), so the brief can mention them.

## Not in this version

- Moving existing mail between labels, or merging "Bills" into "Bills & Transactions" (one-off, done in Gmail).
- Sorting iCloud Mail (IMAP is read-only here).
- Creating Apple Reminders for payments (the Reminders integration is read-only).
- Reading amounts from invoices (bodies are never fetched).
