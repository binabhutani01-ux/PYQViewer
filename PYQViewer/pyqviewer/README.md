# PYQViewer (Vercel)

Static main site with the **original liquid-glass theme, animations, and data/APIs**, plus an upgraded **Owner & Dev Console** (GOD MODE structure from the newer console).

## What this is

| Piece | Source |
|--------|--------|
| Main UI (`index.html`) | Original — liquid glass, ambient orbs, purple/cyan default, full UX |
| Data & APIs (`api/`, `lib/`) | Original Supabase serverless routes |
| Dev console (`dev-console.html`) | Original logic + new console structure (GOD MODE header, status pill, Site Control & God Mode tab) |

No in-memory store. Everything hits Supabase via Vercel serverless functions.

## Deploy on Vercel

1. Create a Vercel project from this folder (or connect the repo).
2. Set environment variables (see `setup.md`):

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_SECRET` (long random string)
   - `GOOGLE_CLIENT_ID` (if using Google teacher login)
   - Owner credentials as used by `api/owner.js` (see `setup.md`)

3. Run the SQL in `setup.md` (and optional files under `sql/`) in your Supabase project.
4. Deploy. Public site: `/` · Owner console: `/dev-console.html`

## Local check (optional)

Vercel CLI:

```bash
npx vercel dev
```

Requires the same env vars.
