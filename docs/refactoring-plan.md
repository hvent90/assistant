# Codebase Refactoring Plan

_Generated 2026-02-07 from a 4-agent parallel review covering architecture, modules, entry points, and tests._

## Executive Summary

The codebase is **fundamentally well-structured** — clean dependency graph (no cycles), proper layering, good module boundaries, and the agents/ pattern is justified. This is not a "burn it down" situation. The issues are targeted: one overloaded file, stale tests, a few missing test areas, and minor inconsistencies. The plan below is organized by priority.

---

## Phase 1: Fix What's Broken (P0)

These should be done immediately — they represent actual bugs or broken invariants.

### 1.1 Fix 3 failing tests in `context.test.ts`

The implementation evolved but tests weren't updated:
- `"heartbeat signals become assistant messages"` — expects assistant-role, implementation now produces system-role with "background process" framing
- `"user signals before heartbeat signals"` — same root cause
- `"produces system + heartbeat prompt, no history"` — expects 2 messages, implementation now produces 4

**Action:** Update test expectations to match current behavior.

### 1.2 Fix timezone fragility in tests

`format-time.test.ts` hardcodes `"3:15 PM"` assuming `TZ=America/Los_Angeles`. Same issue in `context.test.ts:138`. These break in CI or any other timezone.

**Action:** Either set `process.env.TZ` explicitly in test setup, or assert against `formatLocalTime()` output instead of hardcoded strings.

---

## Phase 2: Harden (P1)

Low-effort, high-value improvements to durability.

### 2.1 Add error handling to `discord.ts` messageCreate handler

The `messageCreate` handler has no try/catch. A malformed attachment, a failed `transcribeVoice()` call, or a `fetch()` failure will crash the handler and produce an unhandled rejection.

**Action:** Wrap the handler body in try/catch. Log and gracefully skip bad messages.

### 2.2 Add `process.on("unhandledRejection")` to `main.ts`

Since discord.js events are async, unhandled rejections can propagate silently.

**Action:** Add a global handler that logs and optionally exits.

### 2.3 Add Discord client error/disconnect listeners

No observability into reconnect events. Discord client errors are unobserved.

**Action:** Add `client.on("error")`, `client.on("disconnect")`, `client.on("warn")` handlers with logging.

### 2.4 Isolate DB test state

`scheduler.test.ts` and `db-scheduled.test.ts` both `DELETE FROM scheduled_tasks` in `beforeAll`. Under parallel execution they can interfere.

**Action:** Use unique prefixes/tags per test file, or scope cleanup to test-specific data.

---

## Phase 3: Fill Test Gaps (P1)

These are the highest-value missing tests — all target pure or near-pure functions that are easy to test.

### 3.1 `discord.ts` pure functions

`splitMessage` is critical for correctness (handles code block splitting, Discord's 2000-char limit). `renderViewContent` and `renderViewNodes` are pure rendering functions.

**Action:** Extract these into a testable module (see 4.1) and add tests.

### 3.2 `tools.ts` — `readTool`, `writeTool`, `createSpeakTool`

Only `createScheduleTool` has tests. The other tool definitions are untested.

**Action:** Add behavioral tests for each tool's execute function.

### 3.3 `context.ts` — `buildSystemPrompt`

No direct tests. Tested only indirectly through agent context tests.

**Action:** Add targeted tests for the shared system prompt builder.

---

## Phase 4: Refactor for Composability (P2)

These are structural improvements for long-term maintainability.

### 4.1 Break up `discord.ts` (320 lines, 5 responsibilities)

Currently handles: bot lifecycle, inbound message parsing, slash commands, outbound message delivery, and stream rendering with debounce. It's the largest and most complex file.

**Proposed split:**

| New Module | Responsibility | Lines (approx) |
|---|---|---|
| `discord/client.ts` | Bot lifecycle (login, destroy, event listeners, error handling) | ~50 |
| `discord/inbound.ts` | Message parsing, attachment normalization, signal construction | ~80 |
| `discord/outbound.ts` | `splitMessage`, `sendReply`, stream renderer with debounce | ~100 |
| `discord/commands.ts` | Slash command registration and handling | ~40 |
| `discord/render.ts` | `renderViewContent`, `renderViewNodes` (pure functions) | ~50 |

Alternatively, a lighter touch: keep it as one file but extract `normalizeAttachments()` and the pure rendering/splitting functions into importable helpers. This gets testability without the directory overhead.

**Recommendation:** Start with the lighter approach — extract pure functions into `discord-util.ts` (or similar). Only do the full split if discord.ts continues to grow.

### 4.2 Unify time formatting in system prompt

`buildSystemPrompt()` formats time as `toISOString().replace('T', ' ').substring(0, 19) + ' UTC'`, while agent contexts use `formatLocalTime()`. The LLM sees two different time formats.

**Action:** Replace the ISO-ish format in `buildSystemPrompt()` with `formatLocalTime()`, or remove the time from the base prompt since agent contexts already append it.

### 4.3 Remove dead code: `StatusBoardInstance.format()`

Defined in `types.ts` and implemented in `status-board.ts` but never called anywhere.

**Action:** Delete `format()` from both files.

### 4.4 Deduplicate shutdown handlers in `main.ts`

SIGINT and SIGTERM handlers are identical 7-line blocks.

**Action:**
```ts
const shutdown = async () => {
  console.log("shutting down...")
  heartbeat.stop()
  scheduler.stop()
  discord.destroy()
  await shutdownDb()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
```

### 4.5 Rename misleading test file

`heartbeat-agent.test.ts` only tests `computeStartDelay`. The name suggests it tests the heartbeat agent.

**Action:** Rename to `heartbeat-delay.test.ts` or `compute-start-delay.test.ts`.

---

## Phase 5: Future Considerations (P3)

Not urgent, but worth tracking.

### 5.1 `db.ts` table domain separation

Currently manages 4 table domains (messages, sessions, KV, scheduled_tasks) in one file. Fine at 139 lines but will be the first file to outgrow its structure if scheduling grows.

**Action:** No action now. Split into `db/messages.ts`, `db/sessions.ts`, `db/kv.ts`, `db/scheduled.ts` when any domain gets complex enough.

### 5.2 Extract attachment normalization

The image (fetch → base64) and audio (fetch → transcribe) processing in `discord.ts` is transport-agnostic. If another transport ever needs it, this should be shared.

**Action:** No action now unless a second transport is added.

### 5.3 Hardcoded paths in `transcribe.ts`

`/opt/homebrew/bin/ffmpeg` and `/opt/homebrew/bin/whisper-cli` are macOS Homebrew-specific.

**Action:** No action needed for a personal assistant. Note for portability if scope changes.

---

## What NOT to Change

The review confirmed these are working well and should be left alone:

- **The agents/ pattern** (index.ts + run.ts + context.ts) — justified separation of lifecycle, orchestration, and prompt concerns
- **Signal queue architecture** — elegant single-consumer design
- **StatusBoard as inter-agent coordination** — simple and effective
- **Composition root pattern in main.ts** — explicit wiring, no hidden singletons
- **No-mocks testing principle** — fully adhered to across all tests
- **Module granularity** — small, focused modules (collect, projection, queue, memory, format-time) are correctly scoped
- **Type definitions in types.ts** — lean, all actively used

---

## Execution Order

```
Phase 1 (fix broken)     →  ~30 min, do first
Phase 2 (harden)         →  ~1 hour, do second
Phase 3 (test gaps)      →  ~2 hours, pairs well with Phase 4
Phase 4 (refactor)       →  ~2 hours, can be done incrementally
Phase 5 (future)         →  track, don't act
```

Each phase is independent and can be done in a single session. Phases 3 and 4 overlap (extracting pure functions from discord.ts enables testing them).
