-- Stop a crashing run from being retried forever.
--
-- `claim_agent_run` re-claimed any row stuck in `running` past `stale_after`,
-- incremented `attempts`, and never read it back. A run that kills the worker
-- was therefore reclaimed every ten minutes indefinitely, burning model tokens
-- on each cycle with nothing to show for it. Stale reclaim is the right
-- mechanism — it is what recovers from a worker that died mid-run — it just
-- needed a ceiling.
--
-- Two changes:
--   * a run that has already spent its attempts is retired as `failed`
--   * the claim predicate ignores anything at or over the cap
--
-- The old two-argument function is dropped rather than replaced: adding a
-- parameter creates an overload, and `rpc('claim_agent_run', { worker_id })`
-- would then be ambiguous. Dropping also drops its grants, so they are
-- re-applied below.

drop function if exists public.claim_agent_run(text, interval);

create function public.claim_agent_run(
  worker_id text,
  stale_after interval default interval '10 minutes',
  max_attempts int default 3
)
returns setof public.agent_runs
language sql
security definer
set search_path = public
as $$
  with retired as (
    -- Already burned its attempts. It killed the worker that many times; the
    -- next cycle costs the same and ends the same way.
    update public.agent_runs
    set status = 'failed',
        error = coalesce(
          error,
          format('abandoned after %s attempt(s) — the run did not report a result', attempts)
        ),
        finished_at = now(),
        updated_at = now()
    where status = 'running'
      and claimed_at < now() - stale_after
      and attempts >= max_attempts
    returning id
  ),
  claimed as (
    update public.agent_runs
    set status = 'running',
        claimed_at = now(),
        claimed_by = worker_id,
        attempts = attempts + 1,
        updated_at = now()
    where id = (
      select id from public.agent_runs
      where attempts < max_attempts
        and (
          status = 'queued'
          or (status = 'running' and claimed_at < now() - stale_after)
        )
      order by created_at
      for update skip locked
      limit 1
    )
    returning *
  )
  -- `retired` is not selected from, but a data-modifying CTE always runs. The
  -- two sets cannot overlap: one requires attempts >= cap, the other < cap.
  select * from claimed;
$$;

-- Only the worker (service role) may claim. `revoke ... from public` does not
-- remove Supabase's default grant to `anon`, so each API role is named.
revoke execute on function public.claim_agent_run(text, interval, int) from public;
revoke execute on function public.claim_agent_run(text, interval, int) from anon;
revoke execute on function public.claim_agent_run(text, interval, int) from authenticated;
grant  execute on function public.claim_agent_run(text, interval, int) to service_role;
