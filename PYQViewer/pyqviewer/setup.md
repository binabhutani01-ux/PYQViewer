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

One honesty note on scope: a true "crash/restart the live deployment" control would require
giving this app a Vercel API token with deploy permissions, which is a much bigger security
surface than the app itself. What's built instead is a maintenance-mode kill switch, which
gets you the practical effect (the public site goes fully dark) without handing a web app
the ability to redeploy or delete your Vercel project. Say the word if you actually want the
Vercel-API version and I'll wire it up with a scoped token.
