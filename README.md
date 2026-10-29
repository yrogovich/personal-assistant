# Personal Dashboard

Single-user, local dashboard for weekly and monthly goal progress. See `VISION.md` for the why and `SETUP.md` to run it.

```bash
pnpm dev             # http://localhost:3000
pnpm typecheck
pnpm db:generate     # after changing src/server/db/schema.ts (migrations apply on server start)
```
