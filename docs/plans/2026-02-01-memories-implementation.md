# Memories Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent memory to the assistant via markdown files on disk (`soul.md`, `user.md`, `diary/`), injected into context on each agent run.

**Architecture:** A `readMemoryFiles()` function reads `memories/soul.md` and `memories/user.md` from disk. `buildContext()` gains a new variant — `buildConversationContext` and `buildHeartbeatContext` — since the two agents have different context pipelines. The heartbeat agent no longer receives automatic conversation history. Memory instructions are added to the system prompt so the agent knows how to use its files.

**Tech Stack:** Bun (runtime + test runner), Node `fs/promises` (file reads), existing `context.ts` module.

---

### Task 1: Add `memories/` to `.gitignore`

**Files:**
- Modify: `.gitignore`

**Step 1: Add the entry**

Append `memories/` to `.gitignore`:

```
memories/
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore memories directory"
```

---

### Task 2: Create `readMemoryFiles` function with tests

**Files:**
- Create: `src/memory.ts`
- Create: `src/memory.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { readMemoryFiles } from "./memory"
import { mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"

const TEST_DIR = join(import.meta.dir, "../.test-memories")

describe("readMemoryFiles", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  test("returns null for both when directory does not exist", async () => {
    const result = await readMemoryFiles("/tmp/nonexistent-memory-dir-xyz")
    expect(result.soul).toBeNull()
    expect(result.user).toBeNull()
  })

  test("reads soul.md when it exists", async () => {
    await writeFile(join(TEST_DIR, "soul.md"), "I am helpful.")
    const result = await readMemoryFiles(TEST_DIR)
    expect(result.soul).toBe("I am helpful.")
  })

  test("reads user.md when it exists", async () => {
    await writeFile(join(TEST_DIR, "user.md"), "User likes TypeScript.")
    const result = await readMemoryFiles(TEST_DIR)
    expect(result.user).toBe("User likes TypeScript.")
  })

  test("returns null for missing files even when directory exists", async () => {
    const result = await readMemoryFiles(TEST_DIR)
    expect(result.soul).toBeNull()
    expect(result.user).toBeNull()
  })

  test("reads both files when both exist", async () => {
    await writeFile(join(TEST_DIR, "soul.md"), "soul content")
    await writeFile(join(TEST_DIR, "user.md"), "user content")
    const result = await readMemoryFiles(TEST_DIR)
    expect(result.soul).toBe("soul content")
    expect(result.user).toBe("user content")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/memory.test.ts`
Expected: FAIL — `readMemoryFiles` does not exist

**Step 3: Write the implementation**

```typescript
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export type MemoryFiles = {
  soul: string | null
  user: string | null
}

export async function readMemoryFiles(memoriesDir: string): Promise<MemoryFiles> {
  const [soul, user] = await Promise.all([
    readFile(join(memoriesDir, "soul.md"), "utf-8").catch(() => null),
    readFile(join(memoriesDir, "user.md"), "utf-8").catch(() => null),
  ])
  return { soul, user }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/memory.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory.ts src/memory.test.ts
git commit -m "feat: readMemoryFiles — reads soul.md and user.md from disk"
```

---

### Task 3: Split `buildContext` into conversation and heartbeat variants

This is the core refactor. Currently `buildContext` is a single function that both agents call. We need two variants:

- `buildConversationContext` — includes history + trigger signal
- `buildHeartbeatContext` — no history, heartbeat prompt only

Both include: system prompt, memory files, status board.

**Files:**
- Modify: `src/context.ts`
- Modify: `src/context.test.ts`

**Step 1: Write failing tests for the new functions**

Replace the contents of `src/context.test.ts` with:

```typescript
import { describe, test, expect } from "bun:test"
import { buildConversationContext, buildHeartbeatContext } from "./context"
import type { Signal, StatusBoard } from "./types"
import type { MemoryFiles } from "./memory"

describe("buildConversationContext", () => {
  const baseBoard: StatusBoard = {
    conversation: { status: "idle", detail: null },
    heartbeat: { status: "idle", detail: null },
  }
  const noMemory: MemoryFiles = { soul: null, user: null }

  test("message signal produces system + history + user message", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hello" }], timestamp: 1 },
    ]

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory: noMemory,
    })

    expect(messages[0]!.role).toBe("system")
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "hello" })
  })

  test("multiple drained messages become one user turn", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hey" }], timestamp: 1 },
      { type: "message", source: "discord", content: [{ type: "text", text: "whats up" }], timestamp: 2 },
    ]

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory: noMemory,
    })
    const userMsgs = messages.filter((m) => m.role === "user")
    expect(userMsgs).toHaveLength(1)
    expect(userMsgs[0]!.content).toContain("hey")
    expect(userMsgs[0]!.content).toContain("whats up")
  })

  test("includes memory in system prompt when soul.md exists", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]
    const memory: MemoryFiles = { soul: "I am a helpful assistant.", user: null }

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("I am a helpful assistant.")
  })

  test("includes memory in system prompt when user.md exists", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]
    const memory: MemoryFiles = { soul: null, user: "User prefers TypeScript." }

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("User prefers TypeScript.")
  })

  test("includes conversation history", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]
    const history = [
      { role: "user", content: [{ type: "text" as const, text: "earlier message" }] },
      { role: "assistant", content: [{ type: "text" as const, text: "earlier reply" }] },
    ]

    const messages = buildConversationContext({
      signals,
      history,
      statusBoard: baseBoard,
      memory: noMemory,
    })
    const texts = messages.map((m) => m.content)
    expect(texts.some((t) => t.includes("earlier message"))).toBe(true)
    expect(texts.some((t) => t.includes("earlier reply"))).toBe(true)
  })

  test("status board is included when agents are active", () => {
    const board: StatusBoard = {
      conversation: { status: "idle", detail: null },
      heartbeat: { status: "running", detail: "writing a recipe" },
    }
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: board,
      memory: noMemory,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("writing a recipe")
  })
})

describe("buildHeartbeatContext", () => {
  const baseBoard: StatusBoard = {
    conversation: { status: "idle", detail: null },
    heartbeat: { status: "idle", detail: null },
  }
  const noMemory: MemoryFiles = { soul: null, user: null }

  test("produces system + heartbeat prompt, no history", () => {
    const messages = buildHeartbeatContext({
      statusBoard: baseBoard,
      memory: noMemory,
    })

    expect(messages[0]!.role).toBe("system")
    const userMsg = messages.find((m) => m.role === "user")
    expect(userMsg!.content).toContain("heartbeat")
    // No history messages — only system and user
    expect(messages).toHaveLength(2)
  })

  test("includes memory when files exist", () => {
    const memory: MemoryFiles = { soul: "I am thoughtful.", user: "User likes coffee." }

    const messages = buildHeartbeatContext({
      statusBoard: baseBoard,
      memory,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("I am thoughtful.")
    expect(system!.content).toContain("User likes coffee.")
  })

  test("includes status board when agents are active", () => {
    const board: StatusBoard = {
      conversation: { status: "running", detail: "replying to user" },
      heartbeat: { status: "idle", detail: null },
    }

    const messages = buildHeartbeatContext({
      statusBoard: board,
      memory: noMemory,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("replying to user")
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/context.test.ts`
Expected: FAIL — `buildConversationContext` and `buildHeartbeatContext` don't exist

**Step 3: Rewrite context.ts with the two functions**

Replace `src/context.ts` with:

```typescript
import type { Signal, StatusBoard, ContentBlock } from "./types"
import type { MemoryFiles } from "./memory"

type Message = { role: "system" | "user" | "assistant"; content: string }

type ConversationContextInput = {
  signals: Signal[]
  history: Array<{ role: string; content: ContentBlock[] }>
  statusBoard: StatusBoard
  memory: MemoryFiles
}

type HeartbeatContextInput = {
  statusBoard: StatusBoard
  memory: MemoryFiles
}

function buildSystemPrompt(statusBoard: StatusBoard, memory: MemoryFiles): string {
  let prompt = `You are a personal AI assistant. You run in the background and help your user with whatever they need. You have access to bash for executing commands, reading files, and querying databases.`

  // Memory instructions
  prompt += `\n\nYou have persistent memory stored as files in the memories/ directory. You can read and write these files using bash.`
  prompt += `\n- memories/soul.md — Your personality. Update this when you learn something important about yourself.`
  prompt += `\n- memories/user.md — Facts about your user. Update this when you learn something important about them.`
  prompt += `\n- memories/diary/ — Timestamped diary entries (YYYY-MM-DDTHH-MM-SS.md). Write entries to summarize significant events.`
  prompt += `\n\nRewrite soul.md and user.md in full when updating (they are living documents). Diary entries are append-only (one file per entry, never modify).`

  // Inject soul.md
  if (memory.soul) {
    prompt += `\n\n## Your Personality\n${memory.soul}`
  }

  // Inject user.md
  if (memory.user) {
    prompt += `\n\n## About the User\n${memory.user}`
  }

  // Status board
  const activeAgents = Object.entries(statusBoard).filter(([_, s]) => s.status === "running")
  if (activeAgents.length > 0) {
    const lines = activeAgents.map(([name, s]) => `- ${name}: ${s.detail ?? "working"}`).join("\n")
    prompt += `\n\nYour other processes currently running:\n${lines}`
  }

  return prompt
}

export function buildConversationContext({ signals, history, statusBoard, memory }: ConversationContextInput): Message[] {
  const messages: Message[] = []

  messages.push({ role: "system", content: buildSystemPrompt(statusBoard, memory) })

  // Conversation history
  for (const msg of history) {
    const text = msg.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
    if (text) {
      messages.push({ role: msg.role as "user" | "assistant", content: text })
    }
  }

  // Trigger payload
  const parts: string[] = []
  for (const sig of signals) {
    if (sig.content) {
      for (const block of sig.content) {
        if (block.type === "text") parts.push(block.text)
      }
    }
  }
  if (parts.length > 0) {
    messages.push({ role: "user", content: parts.join("\n") })
  }

  return messages
}

export function buildHeartbeatContext({ statusBoard, memory }: HeartbeatContextInput): Message[] {
  const messages: Message[] = []

  messages.push({ role: "system", content: buildSystemPrompt(statusBoard, memory) })

  messages.push({
    role: "user",
    content: "This is a heartbeat signal. Reflect on your current state using your memory files. If you need recent conversation context, query the database via bash. Write a diary entry if something significant has happened. Is there anything you should proactively do for the user? If not, respond with [no action needed].",
  })

  return messages
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/context.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/context.ts src/context.test.ts
git commit -m "feat: split buildContext into conversation and heartbeat variants with memory injection"
```

---

### Task 4: Update conversation agent to use new context function

**Files:**
- Modify: `src/conversation-agent.ts`

**Step 1: Update imports and context call**

In `src/conversation-agent.ts`:

1. Change import from `buildContext` to `buildConversationContext`
2. Import `readMemoryFiles` from `./memory`
3. Add `memoriesDir` to opts type
4. Call `readMemoryFiles(memoriesDir)` before building context
5. Pass `memory` to `buildConversationContext`

The updated file:

```typescript
import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/zen"
import { bashTool } from "llm-gateway/packages/ai/tools/bash"
import { buildConversationContext } from "./context"
import { readMemoryFiles } from "./memory"
import { appendMessage, getRecentMessages } from "./db"
import type { SignalQueue } from "./queue"
import type { DiscordChannel } from "./discord"
import type { ContentBlock } from "./types"
import type { createStatusBoard } from "./status-board"

type ConversationAgentOpts = {
  queue: SignalQueue
  discord: DiscordChannel
  statusBoard: ReturnType<typeof createStatusBoard>
  model: string
  memoriesDir: string
}

export function startConversationAgent(opts: ConversationAgentOpts) {
  const { queue, discord, statusBoard, model, memoriesDir } = opts
  let running = false

  async function runOnce() {
    const signals = queue.drain()
    if (signals.length === 0) return

    running = true
    statusBoard.update("conversation", { status: "running", detail: "responding to user" })

    try {
      const channelId = signals.find((s) => s.channelId)?.channelId

      // Fetch history BEFORE persisting new messages to avoid duplication
      const history = await getRecentMessages(50)

      // Persist inbound messages
      for (const sig of signals) {
        if (sig.content) {
          await appendMessage({
            role: "user",
            content: sig.content,
            source: sig.source,
            channelId: sig.channelId,
            agent: "conversation",
          })
        }
      }

      // Read memory files
      const memory = await readMemoryFiles(memoriesDir)

      // Build context
      const messages = buildConversationContext({
        signals,
        history,
        statusBoard: statusBoard.get(),
        memory,
      })

      const providerHarness = createGeneratorHarness()
      const agentHarness = createAgentHarness({ harness: providerHarness })
      const orchestrator = new AgentOrchestrator(agentHarness)

      orchestrator.spawn({
        model,
        messages,
        tools: [bashTool],
        permissions: {
          allowlist: [{ tool: "bash", params: { command: "**" } }],
        },
      })

      let fullText = ""
      for await (const { event } of orchestrator.events()) {
        if (event.type === "text") {
          fullText += event.content
        }
        if (event.type === "error") {
          console.error("agent error:", event.error)
        }
      }

      if (fullText && channelId) {
        await discord.send(channelId, fullText)
      }

      if (fullText) {
        const content: ContentBlock[] = [{ type: "text", text: fullText }]
        await appendMessage({
          role: "assistant",
          content,
          source: "conversation",
          agent: "conversation",
        })
      }
    } catch (err) {
      console.error("conversation agent error:", err)
    } finally {
      running = false
      statusBoard.update("conversation", { status: "idle", detail: null })
      runOnce()
    }
  }

  queue.onSignal(() => {
    if (!running) {
      runOnce()
    }
  })

  return { runOnce }
}
```

**Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: Type errors because `main.ts` doesn't pass `memoriesDir` yet (we'll fix in Task 6)

**Step 3: Commit**

```bash
git add src/conversation-agent.ts
git commit -m "feat: conversation agent reads memory files into context"
```

---

### Task 5: Update heartbeat agent to use new context function (no history)

**Files:**
- Modify: `src/heartbeat-agent.ts`

**Step 1: Update the heartbeat agent**

Key changes:
1. Import `buildHeartbeatContext` instead of `buildContext`
2. Import `readMemoryFiles`
3. Add `memoriesDir` to opts
4. Remove `getRecentMessages` import and call
5. Pass `memory` to `buildHeartbeatContext` (no `signals`, no `history`)

The updated file:

```typescript
import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/zen"
import { bashTool } from "llm-gateway/packages/ai/tools/bash"
import { buildHeartbeatContext } from "./context"
import { readMemoryFiles } from "./memory"
import { appendMessage } from "./db"
import type { DiscordChannel } from "./discord"
import type { ContentBlock } from "./types"
import type { createStatusBoard } from "./status-board"

type HeartbeatAgentOpts = {
  discord: DiscordChannel
  statusBoard: ReturnType<typeof createStatusBoard>
  model: string
  intervalMs: number
  memoriesDir: string
}

export function startHeartbeatAgent(opts: HeartbeatAgentOpts) {
  const { discord, statusBoard, model, intervalMs, memoriesDir } = opts
  let running = false
  let timer: ReturnType<typeof setInterval>

  async function tick() {
    if (running) return

    running = true
    statusBoard.update("heartbeat", { status: "running", detail: "reflecting on recent activity" })

    try {
      const memory = await readMemoryFiles(memoriesDir)
      const messages = buildHeartbeatContext({
        statusBoard: statusBoard.get(),
        memory,
      })

      const providerHarness = createGeneratorHarness()
      const agentHarness = createAgentHarness({ harness: providerHarness })
      const orchestrator = new AgentOrchestrator(agentHarness)

      orchestrator.spawn({
        model,
        messages,
        tools: [bashTool],
        permissions: {
          allowlist: [{ tool: "bash", params: { command: "**" } }],
        },
      })

      let fullText = ""
      for await (const { event } of orchestrator.events()) {
        if (event.type === "text") {
          fullText += event.content
        }
        if (event.type === "error") {
          console.error("heartbeat agent error:", event.error)
        }
      }

      if (fullText && !fullText.toLowerCase().includes("[no action needed]")) {
        try {
          const dmId = discord.dmChannelId()
          await discord.send(dmId, fullText)
        } catch {
          // No DM channel yet — user hasn't messaged the bot. Skip sending.
        }
      }

      if (fullText) {
        const content: ContentBlock[] = [{ type: "text", text: fullText }]
        await appendMessage({
          role: "assistant",
          content,
          source: "heartbeat",
          agent: "heartbeat",
        })
      }
    } catch (err) {
      console.error("heartbeat agent error:", err)
    } finally {
      running = false
      statusBoard.update("heartbeat", { status: "idle", detail: null })
    }
  }

  timer = setInterval(tick, intervalMs)

  return {
    tick,
    stop() {
      clearInterval(timer)
    },
  }
}
```

**Step 2: Verify TypeScript compiles (with expected main.ts errors)**

Run: `bunx tsc --noEmit`
Expected: Type errors from `main.ts` only (missing `memoriesDir` in opts)

**Step 3: Commit**

```bash
git add src/heartbeat-agent.ts
git commit -m "feat: heartbeat agent uses memory, no longer receives automatic history"
```

---

### Task 6: Wire `memoriesDir` through `main.ts` and add to `.gitignore`

**Files:**
- Modify: `src/main.ts`

**Step 1: Add `memoriesDir` constant and pass to both agents**

Add after the existing env constants at the top of `main.ts`:

```typescript
import { join } from "node:path"
```

And add the constant:

```typescript
const MEMORIES_DIR = join(import.meta.dir, "../memories")
```

Update `startConversationAgent` call to include `memoriesDir: MEMORIES_DIR`.

Update `startHeartbeatAgent` call to include `memoriesDir: MEMORIES_DIR`.

The full updated `main.ts`:

```typescript
import { join } from "node:path"
import { createSignalQueue } from "./queue"
import { createStatusBoard } from "./status-board"
import { createDiscordChannel } from "./discord"
import { startConversationAgent } from "./conversation-agent"
import { startHeartbeatAgent } from "./heartbeat-agent"
import { initDb, ping, shutdown as shutdownDb } from "./db"

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://assistant:assistant@localhost:5434/assistant"
const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "glm-4.7"
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 1800000)
const DISCORD_ALLOWED_USERNAME = process.env.DISCORD_ALLOWED_USERNAME
const MEMORIES_DIR = join(import.meta.dir, "../memories")

async function main() {
  console.log("assistant starting...")

  initDb(DATABASE_URL)
  await ping()
  console.log("database connected")

  const queue = createSignalQueue()
  const statusBoard = createStatusBoard()

  const discord = createDiscordChannel({
    token: DISCORD_BOT_TOKEN,
    queue,
    allowedUsername: DISCORD_ALLOWED_USERNAME,
  })
  await discord.start()
  console.log("discord bot online")

  startConversationAgent({
    queue,
    discord,
    statusBoard,
    model: DEFAULT_MODEL,
    memoriesDir: MEMORIES_DIR,
  })
  console.log("conversation agent ready")

  const heartbeat = startHeartbeatAgent({
    discord,
    statusBoard,
    model: DEFAULT_MODEL,
    intervalMs: HEARTBEAT_INTERVAL_MS,
    memoriesDir: MEMORIES_DIR,
  })
  console.log(`heartbeat agent ready (interval: ${HEARTBEAT_INTERVAL_MS}ms)`)

  process.on("SIGINT", async () => {
    console.log("shutting down...")
    heartbeat.stop()
    discord.destroy()
    await shutdownDb()
    process.exit(0)
  })

  process.on("SIGTERM", async () => {
    console.log("shutting down...")
    heartbeat.stop()
    discord.destroy()
    await shutdownDb()
    process.exit(0)
  })

  console.log("assistant is running")
}

main().catch((err) => {
  console.error("fatal:", err)
  process.exit(1)
})
```

**Step 2: Verify TypeScript compiles cleanly**

Run: `bunx tsc --noEmit`
Expected: PASS (no errors)

**Step 3: Run all tests**

Run: `bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire memoriesDir into both agents"
```

---

### Task 7: Delete old `buildContext` export

After tasks 3-6, the old `buildContext` function is no longer used anywhere. Verify and remove.

**Files:**
- Modify: `src/context.ts` (if `buildContext` still exists — it was replaced in Task 3)

**Step 1: Verify no remaining references**

Run: `grep -r "buildContext" src/` — should only find `buildConversationContext` and `buildHeartbeatContext`.

If the old `buildContext` still exists in `context.ts`, remove it. If Task 3 already replaced it entirely, this task is a no-op.

**Step 2: Run all tests**

Run: `bun test`
Expected: PASS

**Step 3: Commit (if changes were made)**

```bash
git add src/context.ts
git commit -m "chore: remove unused buildContext function"
```

---

### Task 8: Seed initial `memories/diary/` directory

The `memories/` directory and its `diary/` subdirectory need to exist for the agent to write to them. The agent could create them via `mkdir -p`, but it's cleaner to ensure the diary directory exists at startup.

**Files:**
- Modify: `src/main.ts`

**Step 1: Add directory creation at startup**

Add import at top of `main.ts`:

```typescript
import { mkdir } from "node:fs/promises"
```

Add after `MEMORIES_DIR` constant, inside `main()`, before "assistant starting..." log:

```typescript
await mkdir(join(MEMORIES_DIR, "diary"), { recursive: true })
```

This is idempotent — `recursive: true` is fine if directories already exist.

**Step 2: Run all tests**

Run: `bun test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: ensure memories/diary directory exists at startup"
```
