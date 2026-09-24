-- Aperture — emergency lockdown of the legacy Supabase project (Phase 1, task 1.1)
--
-- Run in: Supabase dashboard → SQL Editor, as the project owner.
-- Effect: nobody using the public (anon/publishable) key or a user session can read or
-- write any table in the public schema. The legacy demo app stops working; that is intended.
--
-- Before running: export any demo data you want to keep (Table editor → Export to CSV),
-- EXCLUDING the policies.agent_mnemonic column. Never export recovery phrases.

begin;

-- 1. Destroy the plaintext wallet recovery phrases. Treat every wallet that had one as compromised.
update public.policies set agent_mnemonic = null where agent_mnemonic is not null;
alter table public.policies drop column if exists agent_mnemonic;

-- 2. Drop the public view that re-exposed policies.
drop view if exists public.policies_public;

-- 3. Enable RLS on every table in public and drop every existing policy (deny by default).
do $$
declare
  t record;
  p record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t.tablename loop
      execute format('drop policy %I on public.%I', p.policyname, t.tablename);
    end loop;
  end loop;
end $$;

-- 4. Remove direct privileges from the API roles (defence in depth on top of RLS).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

commit;

-- After running: Settings → API → rotate the anon/publishable key and the service-role key.
-- Then verify from a terminal (expect HTTP 401/403 or an empty result, never rows):
--   curl -s -I "https://<project>.supabase.co/rest/v1/policies?select=*" \
--     -H "apikey: <old or new anon key>" -H "Authorization: Bearer <same key>" -H "Prefer: count=exact"
