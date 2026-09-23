-- PYQViewer v3 migration
-- Run in Supabase SQL editor. Existing tables are preserved.

insert into settings (key,value) values
  ('customize_enabled','true'),
  ('default_theme','midnight'),
  ('theme_reset_token','0'),
  ('logo_svg','')
on conflict (key) do nothing;

-- If your existing deployment already has the login_events location columns, these are safe.
alter table login_events add column if not exists region text;
alter table login_events add column if not exists latitude double precision;
alter table login_events add column if not exists longitude double precision;
alter table login_events add column if not exists location_accuracy_m double precision;
alter table login_events add column if not exists location_source text;

notify pgrst, 'reload schema';

-- The iOS upload flow still uses the existing public storage-bucket design.
-- Keep these policies aligned with the app's anonymous Supabase browser client.
drop policy if exists "Public read for worksheets bucket" on storage.objects;
drop policy if exists "Public insert for worksheets bucket" on storage.objects;
create policy "Public read for worksheets bucket" on storage.objects for select to public using (bucket_id='worksheets');
create policy "Public insert for worksheets bucket" on storage.objects for insert to public with check (bucket_id='worksheets');
