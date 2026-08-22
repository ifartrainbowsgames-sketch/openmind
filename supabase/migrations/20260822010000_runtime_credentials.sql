-- Provider credentials for agent RUNTIMES, not just for the chat model.
--
-- `role` was a set of model slots (worker/planner/judge) plus tool slots. An
-- external runtime needs a third thing: the customer's key for a PROVIDER it
-- calls directly. Claude Code runs on Anthropic, and until now a customer had
-- no way to store an Anthropic key at all — so a worker would have fallen back
-- to whatever account the machine happened to be logged into, billing every
-- customer's work to one place. That works perfectly in development, which is
-- what makes it dangerous.
--
-- Resolution is by provider_id, not by role: a customer connects Anthropic once
-- and every runtime that needs Anthropic finds the same row.

alter table public.provider_keys
  drop constraint if exists provider_keys_role_check;

alter table public.provider_keys
  add constraint provider_keys_role_check check (
    role in (
      'worker', 'planner', 'judge',
      'tavily', 'firecrawl', 'e2b', 'browserless',
      -- Provider credential slots, consumed by runtimes rather than by the
      -- chat brain. One per provider per customer.
      'anthropic', 'openai_runtime'
    )
  );

comment on column public.provider_keys.role is
  'worker/planner/judge are model credentials; tavily/firecrawl/e2b/browserless are tool credentials; anthropic/openai_runtime are provider credentials consumed by agent runtimes. One row per role per user.';

-- Lets a runtime find "this customer''s Anthropic key" without scanning roles.
create index if not exists provider_keys_user_provider_idx
  on public.provider_keys (user_id, provider_id);

-- The column grants from 20260820000000 still stand and are the point of this
-- table: `authenticated` may read role/provider_id/hint and delete. It may
-- never read ciphertext or iv, so a decrypted key cannot leave through the
-- API no matter what a client asks for.
