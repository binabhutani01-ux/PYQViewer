# PYQViewer v2 — setup guide

## 1. Supabase: run this SQL
Go to your Supabase project → **SQL Editor** → run:

```sql
create table if not exists teachers (
  id text primary key,
  name text not null,
  email text unique not null,
  google_sub text unique,
  role text not null default 'teacher',       -- 'teacher' | 'head'
  status text not null default 'pending',      -- 'pending' | 'approved'
  created_at timestamptz default now()
);

create table if not exists subjects (
  id text primary key,
  name text not null,
  created_by text references teachers(id),
  created_by_name text,
  approved_by text references teachers(id),
  status text not null default 'pending',      -- 'pending' | 'approved'
  created_at timestamptz default now()
);

create table if not exists sub_subjects (
  id text primary key,
  subject_id text references subjects(id) on delete cascade,
  name text not null,
  created_by text references teachers(id),
  created_by_name text,
  created_at timestamptz default now()
);

create table if not exists worksheets (
  id text primary key,
  subject_id text references subjects(id),
  sub_subject_id text references sub_subjects(id),
  title text not null,
  file_url text not null,
  file_path text,
  teacher_id text references teachers(id),
  teacher_name text,
  created_at timestamptz default now()
);

create table if not exists login_events (
  id text primary key,
  teacher_id text references teachers(id),
  teacher_name text,
  ip text,
  city text,
  country text,
  device text,
  device_key text,
  is_new_device boolean default false,
  created_at timestamptz default now()
);

create table if not exists settings (
  key text primary key,
  value text not null
);
```

This replaces the old single-passcode `settings` row — teachers now sign in with Google,
so there's no shared password to store.

## 2. Supabase Storage bucket
Same as before — bucket named `worksheets`, public, with the two policies from the original
setup (public read + public insert on that bucket).

## 3. Vercel environment variables
Set these in **Project Settings → Environment Variables**:

| Name | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | your project URL | |
| `SUPABASE_SERVICE_ROLE_KEY` | your service_role key | server-only |
| `GOOGLE_CLIENT_ID` | `697451303043-juj3qtdp2c78093csibk82v0lkb5rhmj.apps.googleusercontent.com` | from the OAuth client you created |
| `GOOGLE_CLIENT_SECRET` | *(the secret you generated)* | not currently used server-side by this flow, but keep it set/private for future use — never put it in `index.html` |
| `HEAD_TEACHER_EMAIL` | Bina's Gmail address, lowercase | the first person to log in with this address is auto-approved as **head** teacher |
| `SESSION_SECRET` | any long random string (e.g. generate with `openssl rand -hex 32`) | signs teacher **and** owner session cookies |
| `OWNER1_USER` | `Dev1` | |
| `OWNER1_HASH` | `$2b$10$vry.5mctng2YhIWkiYy6o.WxhMzIqjMjqcvFTgLLzWCMOostrQIdW` | bcrypt hash — the real password isn't stored anywhere in the code or database |
| `OWNER2_USER` | `Dev2` | |
| `OWNER2_HASH` | `$2b$10$nBFf9lBsWPAkdLmrJNl4i.26sWCjaSiNKyzvyHrf21KEwZVwEDGsi` | bcrypt hash of the second owner password |

The two `OWNER*_HASH` values above are the bcrypt hashes of the passwords you gave me. You
can sign in with the original plaintext passwords — they were never written to any file, only
hashed. If you'd rather rotate to new passwords, generate new hashes yourself (Node):
```js
require('bcryptjs').hashSync('your-new-password', 10)
```
and paste the result in as the env var.

## 4. Google Cloud Console — allowed origins
In your OAuth client, confirm **Authorized JavaScript origins** includes your real Vercel
domain (`https://pyqviewer.vercel.app` or whatever it ends up being) — `postmessage`/redirect
URIs aren't needed for this flow since it uses Google Identity Services' one-tap/button flow,
which only needs the JS origin.

## 5. Deploy
Same as before: push to GitHub, import into Vercel, no build settings needed. Vercel will pick
up `api/*.js` automatically and install the new dependencies from `package.json`.

## 6. First-time flow
1. Deploy, then open the site and click **Login → Sign in with Google**, using Bina's Gmail
   (matching `HEAD_TEACHER_EMAIL`). She's auto-approved as the head teacher.
2. Any other teacher registers with their Gmail and shows up under **Teachers → Head
   Oversight → Pending teacher approvals** for Bina to approve.
3. Approved teachers can add subjects (need another teacher to authenticate them) and
   sub-subjects (no approval needed) and upload worksheets.

## 7. The owner console
Go directly to `/dev-console.html` — there's no link to it anywhere in the site. Sign in with
`Dev1` / `Dev2` and the passwords you set. From there you can view every teacher, every login
event, toggle **maintenance mode** (which takes the entire public site offline behind a
"down for maintenance" screen for everyone except this console), and purge all worksheets.

## 8. Update, September 2026 — owner console + force-logout + upload fix

If you're upgrading an existing deployment, run this once in the Supabase SQL editor:

```sql
alter table teachers add column if not exists session_version integer not null default 0;
```

This backs the owner console's new **Force logout** button: bumping a teacher's
`session_version` instantly invalidates their existing signed-in cookie on their
next action, without you needing their password (they never had one).

### Storage upload was likely failing silently
Teachers in this app never actually sign in to **Supabase Auth** — they sign in
with Google, verified on the server, and get a cookie your own API issues. That
means the browser's Supabase client (used only for the direct-to-storage PDF
upload) is always in the **anonymous/`public`** role, never `authenticated`.
If your bucket's insert policy was scoped to `authenticated` (a common default),
every upload would fail with a permissions error — and because the app didn't
surface that clearly, it could look like it just silently did nothing. Re-run
this in the SQL editor to make sure the policies actually match how this app
authenticates:

```sql
drop policy if exists "Public read for worksheets bucket" on storage.objects;
drop policy if exists "Public insert for worksheets bucket" on storage.objects;

create policy "Public read for worksheets bucket"
on storage.objects for select
to public
using (bucket_id = 'worksheets');

create policy "Public insert for worksheets bucket"
on storage.objects for insert
to public
with check (bucket_id = 'worksheets');
```

`to public` covers both `anon` and `authenticated` — right for this app since
the browser is always anonymous from Supabase's point of view. (The `public`
insert policy is intentionally wide open, same trade-off as the original
setup — anyone with the bucket name could upload a PDF. If you want to lock
that down later, the fix would be routing uploads through a server API
instead of direct-to-storage from the browser, which is a bigger change.)

The app has also been changed to keep error toasts on screen for 7 seconds
(errors were fading before they could be read) and to log the underlying
Supabase error to the browser console, so if uploads still fail after the
policy fix, open DevTools → Console during an upload attempt and that will
show exactly what Supabase is rejecting and why.

### Owner console now has real admin power
`/dev-console.html` (`Dev1`/`Dev2`) no longer only toggles maintenance mode
and purges everything. It's now a full admin panel, independent of any
teacher session:
- Approve/reject pending teachers, promote to head or demote, delete accounts
- **Force-logout** any teacher (via the `session_version` bump above)
- Approve/deauthenticate/delete subjects
- Delete individual worksheets (not just "purge everything")
- Still: toggle maintenance mode, purge all worksheets

### Maintenance mode now looks like a crash, not a banner
The public "down for maintenance" screen was replaced with a fake
server-error screen (a red "Application error" line and a stack trace) so it
reads as the site being broken rather than an announced maintenance window.
It's still just the same maintenance-mode kill switch under the hood —
nothing about how it's triggered changed, only what visitors see.

