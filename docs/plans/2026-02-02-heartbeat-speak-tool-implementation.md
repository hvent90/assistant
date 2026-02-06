# Heartbeat Speak Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give heartbeat agent a `speak()` tool that routes communication through the conversation agent instead of sending directly to Discord.

**Architecture:** Heartbeat calls `speak({ thought })` → pushes signal with `type: "heartbeat"` to queue → conversation agent picks it up and sees the thought as `role: "assistant"` (its own prior reasoning) → responds naturally.

**Tech Stack:** TypeScript, llm-gateway orchestrator, Zod schemas

---

### Task 1: Create speak tool factory

**Files:**
- Modify: `src/tools.ts`

**Step 1: Add createSpeakTool factory function**

```typescript
import type { SignalQueue } from "./queue"

const speakSchema = z.object({
  thought: z.string().describe("Your thought process about what to communicate, e.g. 'I noticed the user mentioned a deadline tomorrow, I should check in about that'"),
})

export function createSpeakTool(queue: SignalQueue): ToolDefinition<typeof speakSchema, string> {
  return {
    name: "speak",
    description: "Communicate something to the user. Use when you have something worth saying — a proactive check-in, reminder, or thought to share. The thought you provide will guide how you formulate your message.",
    schema: speakSchema,
    derivePermission: () => ({ tool: "speak", params: {} }),
    execute: async ({ thought }) => {
      queue.push({
        type: "heartbeat",
        source: "heartbeat",
        content: [{ type: "text", text: thought }],
        timestamp: Date.now(),
      })
      const msg = `Queued message for user: "${thought.slice(0, 50)}${thought.length > 50 ? "..." : ""}"`
      return { context: msg, result: msg }
    },
  }
}
```

**Step 2: Run type check**

Run: `bun run --bun tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tools.ts
git commit -m "feat: add createSpeakTool factory for heartbeat-to-conversation routing"
```

---

### Task 2: Pass signal queue to heartbeat agent

**Files:**
- Modify: `src/heartbeat-agent.ts`
- Modify: `src/main.ts`

**Step 1: Update HeartbeatAgentOpts type**

In `src/heartbeat-agent.ts`, add queue to the opts type:

```typescript
import type { SignalQueue } from "./queue"

type HeartbeatAgentOpts = {
  queue: SignalQueue
  discord: DiscordChannel
  statusBoard: StatusBoardInstance
  model: string
  intervalMs: number
  memoriesDir: string
}
```

**Step 2: Destructure queue in startHeartbeatAgent**

Update the destructure at the start of `startHeartbeatAgent`:

```typescript
const { queue, discord, statusBoard, model, intervalMs, memoriesDir } = opts
```

**Step 3: Update main.ts to pass queue**

In `src/main.ts`, add `queue` to the heartbeat agent options:

```typescript
const heartbeat = await startHeartbeatAgent({
  queue,
  discord,
  statusBoard,
  model: DEFAULT_MODEL,
  intervalMs: HEARTBEAT_INTERVAL_MS,
  memoriesDir: MEMORIES_DIR,
})
```

**Step 4: Run type check**

Run: `bun run --bun tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/heartbeat-agent.ts src/main.ts
git commit -m "feat: pass signal queue to heartbeat agent"
```

---

### Task 3: Wire speak tool into heartbeat and remove Discord send

**Files:**
- Modify: `src/heartbeat-agent.ts`

**Step 1: Import createSpeakTool**

Add to imports:

```typescript
import { createSpeakTool, readTool, writeTool } from "./tools"
```

**Step 2: Create speak tool instance and add to tools array**

Inside `startHeartbeatAgent`, before the tick function, create the tool:

```typescript
const speakTool = createSpeakTool(queue)
```

Then in the orchestrator.spawn call, update tools array:

```typescript
tools: [bashTool, readTool, writeTool, speakTool],
```

And update permissions:

```typescript
permissions: {
  allowlist: [{ tool: "bash" }, { tool: "read" }, { tool: "write" }, { tool: "speak" }],
},
```

**Step 3: Remove Discord send and [no action needed] check**

Delete lines 68-75 (the `if (fullText && !fullText.toLowerCase().includes("[no action needed]"))` block and its contents).

The code after the event loop should just be:

```typescript
if (fullText) {
  const content: ContentBlock[] = [{ type: "text", text: fullText }]
  await appendMessage({
    role: "assistant",
    content,
    source: "heartbeat",
    agent: "heartbeat",
  })
}
```

**Step 4: Run type check**

Run: `bun run --bun tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/heartbeat-agent.ts
git commit -m "feat: wire speak tool into heartbeat, remove direct Discord send"
```

---

### Task 4: Update heartbeat prompt

**Files:**
- Modify: `src/context.ts`

**Step 1: Update buildHeartbeatContext prompt**

Replace the user message content in `buildHeartbeatContext`:

```typescript
messages.push({
  role: "user",
  content: `This is a heartbeat signal. Reflect on your current state using your memory files. If you need recent conversation context, query the database via bash.

Write a diary entry if something significant has happened.

If you have something worth communicating to the user — a proactive check-in, reminder, follow-up, or thought to share — use the speak() tool. Otherwise, just complete your reflection without speaking.`,
})
```

**Step 2: Run type check**

Run: `bun run --bun tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/context.ts
git commit -m "feat: update heartbeat prompt to use speak() tool instead of [no action needed]"
```

---

### Task 5: Update buildConversationContext to handle signal types

**Files:**
- Modify: `src/context.ts`

**Step 1: Replace trigger payload section**

Replace lines 74-85 (the "Trigger payload" section) with:

```typescript
// Process signals by type
const userParts: string[] = []
const heartbeatParts: string[] = []

for (const sig of signals) {
  if (sig.content) {
    for (const block of sig.content) {
      if (block.type === "text") {
        if (sig.type === "heartbeat") {
          heartbeatParts.push(block.text)
        } else {
          userParts.push(block.text)
        }
      }
    }
  }
}

// User messages first
if (userParts.length > 0) {
  messages.push({
    role: "user",
    content: `[${new Date().toISOString()}]\n${userParts.join("\n")}`,
  })
}

// Heartbeat thought last (as assistant's own prior reasoning)
if (heartbeatParts.length > 0) {
  messages.push({
    role: "assistant",
    content: heartbeatParts.join("\n"),
  })
}
```

**Step 2: Run type check**

Run: `bun run --bun tsc --noEmit`
Expected: No errors

**Step 3: Run existing tests**

Run: `bun test`
Expected: All tests pass (or update tests if they expect the old behavior)

**Step 4: Commit**

```bash
git add src/context.ts
git commit -m "feat: handle heartbeat signals as assistant role in conversation context"
```

---

### Task 6: Update context tests

**Files:**
- Modify: `src/context.test.ts`

**Step 1: Read existing tests**

Read `src/context.test.ts` to understand current test structure.

**Step 2: Add test for heartbeat signal handling**

Add a test that verifies heartbeat signals become assistant messages:

```typescript
test("buildConversationContext: heartbeat signals become assistant messages", () => {
  const result = buildConversationContext({
    signals: [
      {
        type: "heartbeat",
        source: "heartbeat",
        content: [{ type: "text", text: "I should check in about the deadline" }],
        timestamp: Date.now(),
      },
    ],
    history: [],
    statusBoard: { conversation: { status: "idle", detail: null }, heartbeat: { status: "idle", detail: null } },
    memory: { soul: null, user: null, diary: [] },
    memoriesDir: "/tmp/memories",
    repoRoot: "/tmp/repo",
  })

  const assistantMsg = result.find((m) => m.role === "assistant")
  expect(assistantMsg).toBeDefined()
  expect(assistantMsg!.content).toContain("I should check in about the deadline")
})
```

**Step 3: Add test for mixed signals ordering**

```typescript
test("buildConversationContext: user signals before heartbeat signals", () => {
  const result = buildConversationContext({
    signals: [
      {
        type: "message",
        source: "discord",
        content: [{ type: "text", text: "user message" }],
        timestamp: Date.now(),
      },
      {
        type: "heartbeat",
        source: "heartbeat",
        content: [{ type: "text", text: "heartbeat thought" }],
        timestamp: Date.now(),
      },
    ],
    history: [],
    statusBoard: { conversation: { status: "idle", detail: null }, heartbeat: { status: "idle", detail: null } },
    memory: { soul: null, user: null, diary: [] },
    memoriesDir: "/tmp/memories",
    repoRoot: "/tmp/repo",
  })

  // Find indices of user and assistant messages (excluding system)
  const userIdx = result.findIndex((m) => m.role === "user")
  const assistantIdx = result.findIndex((m) => m.role === "assistant")

  expect(userIdx).toBeGreaterThan(-1)
  expect(assistantIdx).toBeGreaterThan(-1)
  expect(userIdx).toBeLessThan(assistantIdx)
})
```

**Step 4: Run tests**

Run: `bun test src/context.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/context.test.ts
git commit -m "test: add tests for heartbeat signal handling in conversation context"
```

---

### Task 7: Verify end-to-end flow

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 2: Run type check**

Run: `bun run --bun tsc --noEmit`
Expected: No errors

**Step 3: Final commit if needed**

If any fixes were needed, commit them.
