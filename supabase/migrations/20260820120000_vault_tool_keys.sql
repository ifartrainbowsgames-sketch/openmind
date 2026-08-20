-- Tool credentials belong in the vault too.
--
-- `provider_keys.role` allowed only worker/planner/judge, so a background run
-- could carry the customer's model key but no search, browse, sandbox or
-- Chrome key. Those fell through to the deployment's own environment
-- variables in agent-tools, which meant the customer paid for the model and
-- we paid for every tool call — with no way to see it happening.
--
-- Widening the constraint lets a queued run be funded entirely by whoever
-- started it.

alter table public.provider_keys
  drop constraint if exists provider_keys_role_check;

alter table public.provider_keys
  add constraint provider_keys_role_check check (
    role in (
      'worker', 'planner', 'judge',
      'tavily', 'firecrawl', 'e2b', 'browserless'
    )
  );

comment on column public.provider_keys.role is
  'worker/planner/judge are model credentials; tavily/firecrawl/e2b/browserless are tool credentials. One row per role per user.';

-- The column grants from 20260820000000 still apply unchanged: `authenticated`
-- may read role/provider_id/hint and delete, never ciphertext or iv.
