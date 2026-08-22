-- Let a customer connect MANY providers, not three model slots.
--
-- The table already stored one row per (user_id, role) — that part was never
-- the limitation. The limitation was that `role` was a closed enum of nine
-- values, so "connect Anthropic and Grok and OpenAI at once" was unstorable:
-- there were exactly three model slots and two provider slots to put keys in.
--
-- So `role` becomes an open label, and a connection stores role = provider id.
-- One row per provider per customer falls out of the existing primary key with
-- no data migration, no key change, and no dedupe pass — which is the whole
-- reason to do it this way. Every existing row stays valid and keeps working:
-- 'worker'/'planner'/'judge' still satisfy the new check, and the worker still
-- reads them (see the resolution order in worker/index.ts).
--
-- The format check is not decoration. `role` is concatenated into user-facing
-- strings and compared against provider ids, so it is constrained to the shape
-- of an identifier rather than left as free text.

alter table public.provider_keys
  drop constraint if exists provider_keys_role_check;

alter table public.provider_keys
  add constraint provider_keys_role_check check (
    role ~ '^[a-z][a-z0-9_-]{0,39}$'
  );

comment on column public.provider_keys.role is
  'An identifier-shaped label for what this credential is for. A provider connection uses the provider id itself (anthropic, xai, openai…), which is what makes one key per provider possible. worker/planner/judge remain valid and are read as a legacy fallback; tavily/firecrawl/e2b/browserless remain valid for tool credentials. Resolution is by provider_id — see worker/credential-vault.ts.';

-- Unchanged and still the point of this table: `authenticated` may read
-- role/provider_id/hint and delete its own rows, and may NEVER read ciphertext
-- or iv. Widening `role` does not widen what can be read back, because the
-- column grants from 20260820000000 are what enforce that, not the check.
--
-- Restated rather than re-granted: altering a constraint does not touch grants,
-- so there is nothing to reapply here. This comment exists so the next person
-- to widen `role` checks that assumption instead of assuming it.
