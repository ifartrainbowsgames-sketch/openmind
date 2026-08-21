# Known issues

Written 2026-08-20 against `cursor/openmind-v2` @ `7391bbc`.

Baseline at the time of writing: `tsc -b` clean, 562 tests across 48 files pass,
`vite build` succeeds. Nothing here is a build break. What follows is state that
is wrong at runtime, seams left by the `backend-foundations` × `mobile-workspace`
merge, and lifecycle that never gets cleaned up.

Each entry says what actually goes wrong, not just what looks odd.

---

## 1. Merge seams

The merge (`3e0c141`) unified two branches that had each grown their own answer
to the same question. Both answers are still in the tree.

### 1.1 Two key stores, one of them declared dead — but still in use

`src/lib/run-queue.ts:91` states the position plainly:

> the server-held vault is the only place keys belong now

That is true for the background path. It is not true for the foreground path.
`src/pages/MobileApp.tsx:365` loads `MobileProviderConfig` out of localStorage,
and `provider.apiKey` is read straight out of it at:

- `MobileApp.tsx:403` — the worker brain for an in-tab run
- `MobileApp.tsx:420` — OpenAI speech
- `MobileApp.tsx:752` — OpenAI transcription
- `MobileApp.tsx:393` — the planner brain

So a customer key lives in plaintext localStorage whenever background runs are
off, while `provider_keys` holds the encrypted copy for when they are on. Two
stores, different threat models, and the comment only describes one of them.

**Fix direction:** either the vault becomes the source for both paths (foreground
reads it through an Edge Function the way the worker does), or `run-queue.ts:91`
gets rewritten to say "the only place keys belong *for queued runs*". The second
is honest; the first is correct.

### 1.2 `RunOptions.toolKeys` is declared but silently dropped

`src/lib/run-queue.ts:37` declares `toolKeys?: Record<string, string | undefined>`
on the public interface. `sanitizeOptions` (`run-queue.ts:93`) forwards
`workspace`, `skill` and `strictMode` — and nothing else.

Dropping the keys is the right call. Leaving the field on the interface is not:
a caller can pass `toolKeys`, typecheck cleanly, and get a run configured without
them. The field should be deleted, not stripped at the boundary.

### 1.3 Two hiring paths, and the crew never takes the LLM one

- `src/lib/staffing.ts:159` — `generateStaff`, regex/heuristic
- `src/lib/llm-staffing.ts:287` — `generateStaffLLM`, model-driven

`llm-staffing` degrades to `generateStaff` on failure (`llm-staffing.ts:233`,
`:273`), which is a reasonable fallback. The problem is upstream: `src/lib/crew.ts`
calls `generateStaff` directly at `:83`, `:89` and `:234`, and
`WorkforceStudio.tsx:343` does the same. The LLM staffing module is reachable only
from paths the crew runtime does not use.

So the answer to "does OpenMind hire with a model or with regex?" is currently
"regex, unless you go in through a door the product does not open".

`task-planner.ts` / `task-planner-llm.ts` is the *same shape* done correctly —
`planProjectSmart` owns the entry point and falls back to `planProject`
(`task-planner-llm.ts:230`). Staffing should mirror that.

---

## 2. Idle and pending state in `MobileApp.tsx`

This is the densest cluster. The page tracks in-flight work with variables whose
names promise per-thread scoping and whose values are global.

### 2.1 Every thread shows "thinking…" when any thread is working

`MobileApp.tsx:767`:

```ts
const activeStatus = useMemo(() => {
  if (!pendingThreadId) return ''
  return liveTrace.at(-1)?.text ?? `${selectedEmployee.name} is thinking…`
}, [liveTrace, pendingThreadId, selectedEmployee.name])
```

It tests `pendingThreadId` for truthiness. It never compares it to `activeId`.
Start a run in thread A, switch to thread B: thread B shows a live status line for
work that is not happening in it.

**Fix:** `if (pendingThreadId !== activeId) return ''`.

### 2.2 `liveTrace` is global too

`MobileApp.tsx:371` declares one `liveTrace` for the whole page, and the `onTrace`
callback at `:671` appends to it regardless of which thread is being viewed. Same
bug as 2.1, one layer down — the trace lines rendered under the composer can belong
to a different conversation than the one on screen.

Trace belongs on the thread, next to `pendingThreadId`.

### 2.3 `pendingThreadId` is a global send lock

`MobileApp.tsx:613`:

```ts
if (!text || !thread || pendingThreadId) return
```

The guard is "is *anything* running", not "is *this thread* running". A foreground
run in thread A silently swallows a send in thread B — no error, no disabled state
that explains it, the message just does not go.

Background runs dodge this by clearing `pendingThreadId` immediately (`:659`), so
the lock only bites the foreground path. That makes it intermittent, which is worse.

### 2.4 `browserUrl` never clears

`MobileApp.tsx:434`:

```ts
useEffect(() => {
  const blob = (activeThread?.messages ?? []).flatMap(...).join('\n')
  const url = lastHttpUrl(blob)
  if (url) setBrowserUrl(url)
}, [activeThread?.messages])
```

`if (url)` means the effect only ever *sets*. Switch from a thread that browsed
somewhere to a thread that browsed nowhere and the browser pane still shows the
first thread's URL.

This is also the `react-hooks/set-state-in-effect` lint error — and the lint rule
is right for the right reason. This is derived state. It should be a `useMemo` over
`activeThread`, which fixes the staleness and the lint error in one move.

### 2.5 A thread with a live background run can be deleted

`MobileApp.tsx:489`:

```ts
if (pendingThreadId === id) return
```

Background runs set `pendingThreadId` to `null` the moment they are queued
(`:659`). So this guard does not cover them. Delete such a thread and:

- `appendRunMessage` → `updateThread` matches no thread id and no-ops silently
- the run keeps executing on the worker, billing tokens
- its result lands nowhere and the user is never told

**Fix:** guard against any thread holding a message with a non-terminal `runId`,
or cancel the run on delete. Doing nothing is the one option that is wrong.

### 2.6 Provider changes made in the in-app settings sheet do nothing

`MobileApp.tsx:363` carries this comment:

```ts
// Read-only here: /settings owns writes, and returning from that route
// remounts this page, so the fresh config is picked up on mount.
const [provider] = useState<MobileProviderConfig>(() => loadMobileProvider())
```

True for the route. But settings also open **in place** as a sheet — `:588` sets
`settingsOpen`, and `:1192` renders the panel inside this component. That sheet
uses `useProviderConfig` (`src/components/settings/use-settings-state.ts:9`), which
keeps its own copy and calls `saveMobileProvider`.

No remount happens. So changing the model, API key, `backgroundRuns` or
`strictMode` from inside the app writes to localStorage and leaves the running page
on its mount-time values — `brain()`, `liveReady`, `providerSpec` and the voice
path all keep using the old config until a full reload.

The comment is not wrong about the route. It is wrong about being the only way in.

**Fix:** subscribe to the config, or re-read `loadMobileProvider()` when
`settingsOpen` goes false.

### 2.7 Thread persistence is unguarded

`MobileApp.tsx:441` writes the entire thread array to localStorage on every change,
and threads carry `trace`, `toolCalls` and `crewRun.artifacts` — full tool outputs.
That grows without bound against a ~5 MB quota, and a `QuotaExceededError` thrown
inside a `useEffect` takes out the page rather than degrading.

Needs a try/catch and a cap — trim old messages, or stop persisting tool output.

### 2.8 `finishedRuns` grows forever

`MobileApp.tsx:505` — run ids are added on completion and never removed for the
life of the page. Small, but it is a leak in the same subsystem as the rest of this
section, so it may as well be fixed alongside.

---

## 3. Worker sessions and worktrees never get reaped

### 3.1 `staleSessions` has no production caller

`src/lib/workforce/sessions.ts:122` exports `staleSessions`, documented as
"sessions eligible for cleanup. Callers decide what closing costs."

There are no callers. The only references outside the module are in
`runtime.test.ts:153-155`. Nothing sweeps. Sessions past `SESSION_IDLE_MS`
(15 minutes, `sessions.ts:37`) are correctly refused for *resume* by `isResumable`,
so they are not dangerous — they are just never removed, and the store only grows.

### 3.2 The session store is not durable, despite the docstring

`sessions.ts:2-13` frames sessions as "the durable half of a worker" and points at
Claude Code and Codex resumable session ids as the reason.

The store is a plain `let` inside a factory: `builtin-adapter.ts:44`
(`let store: SessionStore = emptySessionStore()`). It lives and dies with the
process. `providerSessionId` is captured (`recordActivity`) and then lost on
restart — exactly the "stateless and expensive" behaviour the docstring says this
module exists to prevent.

The pure functions are fine and well tested. What is missing is a persistence layer
under them.

### 3.3 Worktrees accumulate by design

`src/lib/workforce/worktrees.ts:127`:

> Remove a worktree once its work is captured. Not called automatically — a
> worktree removed before its diff was reviewed destroys the only copy.

The reasoning is sound and the decision is deliberate, so this is not a bug. It is
an unbounded disk cost under `WORKTREE_ROOT` (`/home/user/worktrees`,
`worktrees.ts:25`) with no sweeper and no ceiling. It needs an owner eventually.

---

## 4. Run queue lifecycle

### 4.1 A crashing run is a poison pill

`supabase/migrations/20260820000000_runs_and_keys.sql:96` — `claim_agent_run`
re-claims any row stuck in `running` for more than 10 minutes:

```sql
where status = 'queued'
   or (status = 'running' and claimed_at < now() - stale_after)
```

It increments `attempts` and never reads it. `worker/index.ts:31` pulls `attempts`
into `RunRow` and `:97` logs it — no cap anywhere.

A run that kills the worker gets reclaimed every 10 minutes, forever, burning
tokens each cycle. Stale reclaim is the right mechanism; it just needs
`and attempts < N` in the predicate and a terminal `failed` for the rest.

### 4.2 Cancel does not cancel

`src/lib/run-queue.ts:159` sets `status = 'cancelled'` and calls it done. The
worker never re-reads the row mid-run — `executeRun` (`worker/index.ts:95`) runs
to completion regardless.

Worse, `patchRun` (`worker/index.ts:87`) updates by id with no status guard, so on
completion it overwrites `cancelled` with `completed`. The user's cancellation is
not merely ignored, it is erased.

**Fix:** poll status inside the run loop, and add `.eq('status', 'running')` to the
terminal write so a cancelled row cannot be resurrected.

### 4.3 `watchRun`'s poll survives a deleted row

`run-queue.ts:131` polls every 5s with `.single()` and discards the error. If the
row is gone, `data` is null, `isTerminal` is never reached, `clearInterval` never
fires, and the poll runs until the caller happens to stop it. The subscription
teardown in `MobileApp` does eventually cover this, so the blast radius is small —
but the interval should stop itself on a missing row.

---

## 5. Lint

`npm run lint` exits 1 — 6 errors, 12 warnings.

Genuine, one line each:

| Location | Error |
|---|---|
| `src/lib/crew.ts:286` | `_state` unused — `tableNode` is a stub returning `{}` |
| `src/lib/openmind-os.ts:74` | `prompt` is `let`, never reassigned |
| `supabase/functions/nango-act/index.ts:387` | useless escape `\/` |
| `src/pages/MobileApp.tsx:437` | `set-state-in-effect` — see §2.4 |

**False positives**, both `react-hooks/purity` on `Date.now()`
(`MobileApp.tsx:615`, `:687`): the calls sit inside `sendPrompt`, an async event
handler declared at `:577`. Because it is a bare `const fn = async () => {}` in the
component body rather than a `useCallback`, the rule cannot prove it is not called
during render. Wrapping `sendPrompt` in `useCallback` silences both correctly.

The 12 warnings are all `react-refresh/only-export-components` — files exporting
constants alongside components, 8 of them in `ChatWidget.tsx`. HMR-only, cosmetic.

---

## 6. Bundle size

`vite build` warns on two chunks:

- `brains` — 1,035 kB (281 kB gzip)
- `three.module` — 734 kB (189 kB gzip)

`three` is already split behind `LazyThree`. `brains` at a megabyte is the one
worth attention.

---

## 7. Process note

While this document was being written, the working tree changed three times under
an unrelated session — `scripts/verify-mcp.ts` appeared and was committed as
`0d85d3b`, then `crew-tools.ts` was modified and committed as `7391bbc`.

Line numbers here are pinned to `7391bbc`. Re-check before acting on any of them.

---

## Suggested order

1. **§2.1, §2.2, §2.3** — one coherent change: move pending/trace state onto the
   thread. Fixes three visible bugs at once.
2. **§4.2** — cancel silently doing nothing, then being erased, is the worst
   behaviour in this list.
3. **§2.6** — settings that appear to save and do not.
4. **§4.1** — needs an attempt cap before background runs see real load.
5. **§2.4 + §5** — the derived-state fix clears a real bug and a lint error.
6. **§1.1** — decide which key store is true, then make the comment match.
7. Everything else.
