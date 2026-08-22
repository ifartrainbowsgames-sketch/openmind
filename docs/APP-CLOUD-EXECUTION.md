# /app Cloud Execution — Findings (2026-08-22)

Branch: `cursor/openmind-v2` @ `adae58f` (verified at start of fix).

Production URL: `https://openmind-production-2f0f.up.railway.app/app`

## Current send path (before fix)

```
MobileApp.sendPrompt()
  → provisionWorkspace()
  → if provider.backgroundRuns === true
       enqueueRun() → watchRun() → appendRunMessage()
     else
       withExecutionMode(strictMode ? 'strict' : 'demo', () =>
         runTurn(crewPrompt, brain(), { ... }))
```

### `brain()` selection (foreground path)

```
mobileLiveReady(provider)  // localStorage apiKey OR keyless provider spec
  ? liveBrain({ key: provider.apiKey, ... })
  : simulatedBrain()
```

**Logged-in production customers without a browser key hit `simulatedBrain()`** unless they manually enabled `backgroundRuns` in local settings.

### Runtime selection today

| Condition | Path |
|-----------|------|
| `backgroundRuns === true` + signed in | `enqueueRun()` → worker → vault keys |
| `backgroundRuns === false` + no local key | **`simulatedBrain()` in tab** |
| `backgroundRuns === false` + local key | `liveBrain()` in tab via `runTurn()` |
| Not signed in + `enqueueRun()` | throws (never reached unless backgroundRuns) |

### Provider key source

| Path | Key source |
|------|------------|
| Foreground `liveBrain` | `localStorage` `openmind-mobile-provider-v1` |
| `enqueueRun` / worker | Supabase `provider_keys` vault (decrypted server-side) |
| `simulatedBrain` | none (canned/heuristic) |

### Worker note

`worker/index.ts` used `simulatedBrain()` when no vault worker key and `strictMode !== true`. Cloud runs from `/app` now always enqueue with `strictMode: true` and the worker refuses missing credentials instead of simulating.

## Railway deployment

`railway.toml` in repo only defines:

- Docker build with `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`, `VITE_ROUTER=browser`
- Health check on `/`

**The deployed branch/commit cannot be proven from the repo alone.** After merging this fix, verify in Railway dashboard or CLI: web service branch, worker service, env vars (`SUPABASE_*`, `KEY_ENCRYPTION_SECRET`, worker poll).

## Fix summary

Three explicit modes:

1. **Cloud** (default when signed in) → `enqueueRun()`, vault credentials, `strictMode: true`
2. **Browser Direct** (explicit) → `runTurn()` + `liveBrain()`, requires local key
3. **Demo** (explicit or signed out) → `simulatedBrain()` only when `executionMode === 'demo'`

No implicit simulator fallback for authenticated customers.

## After fix (same branch)

```
MobileApp.sendPrompt()
  → resolveSendRoute(executionMode, cloudReadiness, …)
  → cloud (default, signed in)
       fetchCloudReadiness() → vault worker key metadata
       if ready → enqueueRun(strictMode: true, runtimeId?) → watchRun()
       if not  → blocked assistant message + link to /settings/keys
  → browser_direct (explicit)
       if local key → runTurn(liveBrain, strict)
       if not       → blocked
  → demo (explicit or signed out default)
       → runTurn(simulatedBrain, demo mode)
```

Execution mode UI: `/app` Settings sheet — **Cloud | Browser | Demo**, plus runtime **OpenMind Native | Claude Code**.

Worker: missing vault worker key → `needs_user` (never `simulatedBrain`).

Tests: `src/lib/app-send.test.ts` (15 routing/UX invariants).

**Railway:** still cannot verify deployed commit from repo — redeploy `cursor/openmind-v2` after merge and confirm worker service env vars.
