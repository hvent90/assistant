# V1 Background Assistant — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A barebones background assistant that responds to Discord messages via llm-gateway's agent harness, runs a periodic heartbeat, and persists conversation history to Postgres.

**Architecture:** A single pm2-managed Bun process. Discord.js bot receives messages and pushes them to an in-memory queue. A core loop drains the queue and invokes llm-gateway's agent harness. A heartbeat timer fires periodically and invokes a separate agent run. Both agents share a status board and conversation history in Postgres.

**Tech Stack:** Bun, TypeScript, discord.js, llm-gateway (local dependency), PostgreSQL, pm2

---

### Task 1: Project Scaffolding

**Files:**
- Create: `src/main.ts`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `ecosystem.config.cjs`

**Step 1: Create package.json**

```json
{
  "name": "assistant",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/main.ts",
    "start": "bun run src/main.ts",
    "pm2:start": "bunx pm2 start ecosystem.config.cjs",
    "pm2:stop": "bunx pm2 stop all",
    "pm2:restart": "bunx pm2 restart all",
    "pm2:logs": "bunx pm2 logs",
    "pm2:status": "bunx pm2 status"
  },
  "dependencies": {
    "llm-gateway": "link:../llm-gateway"
  }
}
```

**Step 2: Install dependencies**

Run: `cd ~/repos/assistant && bun install`
Then: `bun add discord.js`

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true
  }
}
```

**Step 4: Create .env.example**

```
DISCORD_BOT_TOKEN=
DISCORD_CHANNEL_ID=
ANTHROPIC_API_KEY=
DEFAULT_MODEL=claude-sonnet-4-20250514
HEARTBEAT_INTERVAL_MS=1800000
DATABASE_URL=postgres://assistant:assistant@localhost:5432/assistant
```

**Step 5: Create ecosystem.config.cjs**

```javascript
const path = require('path');
const logsDir = path.join(__dirname, 'logs');

module.exports = {
  apps: [
    {
      name: 'assistant',
      script: 'bun',
      args: 'run src/main.ts',
      autorestart: true,
      watch: false,
      output: path.join(logsDir, 'assistant-out.log'),
      error: path.join(logsDir, 'assistant-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
```

**Step 6: Create src/main.ts (placeholder)**

```typescript
console.log("assistant starting...")
```

**Step 7: Verify it runs**

Run: `cd ~/repos/assistant && bun run src/main.ts`
Expected: prints "assistant starting..."

**Step 8: Commit**

```bash
git add package.json tsconfig.json .env.example ecosystem.config.cjs src/main.ts
git commit -m "scaffold: project setup with pm2, discord.js, llm-gateway link"
```

---

### Task 2: Signal and Queue Types

**Files:**
- Create: `src/types.ts`
- Create: `src/queue.ts`
- Create: `src/queue.test.ts`

**Step 1: Write src/types.ts**

Define the core Signal type and agent status types. These are the fundamental data shapes everything else builds on.

```typescript
export type Signal = {
  type: "message" | "heartbeat"
  source: string
  content: ContentBlock[] | null
  channelId?: string
  metadata?: Record<string, unknown>
  timestamp: number
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; path: string; mimeType: string }
  | { type: "file"; path: string; filename: string }

export type AgentStatus = {
  status: "idle" | "running"
  detail: string | null
}

export type StatusBoard = {
  conversation: AgentStatus
  heartbeat: AgentStatus
}
```

**Step 2: Write the failing test for the queue**

The queue needs two operations: `push` (add a signal) and `drain` (take all signals, leaving the queue empty).

```typescript
// src/queue.test.ts
import { describe, test, expect } from "bun:test"
import { createSignalQueue } from "./queue"

describe("SignalQueue", () => {
  test("drain returns empty array when queue is empty", () => {
    const q = createSignalQueue()
    expect(q.drain()).toEqual([])
  })

  test("drain returns all pushed signals and empties the queue", () => {
    const q = createSignalQueue()
    const sig1 = { type: "message" as const, source: "discord", content: [{ type: "text" as const, text: "hello" }], timestamp: 1 }
    const sig2 = { type: "message" as const, source: "discord", content: [{ type: "text" as const, text: "world" }], timestamp: 2 }
    q.push(sig1)
    q.push(sig2)

    const drained = q.drain()
    expect(drained).toEqual([sig1, sig2])
    expect(q.drain()).toEqual([])
  })

  test("push during drain does not include new signal", () => {
    const q = createSignalQueue()
    q.push({ type: "message" as const, source: "discord", content: null, timestamp: 1 })
    const drained = q.drain()
    expect(drained).toHaveLength(1)

    q.push({ type: "message" as const, source: "discord", content: null, timestamp: 2 })
    const drained2 = q.drain()
    expect(drained2).toHaveLength(1)
  })

  test("onSignal callback fires when signal is pushed", () => {
    const q = createSignalQueue()
    let called = false
    q.onSignal(() => { called = true })
    q.push({ type: "message" as const, source: "discord", content: null, timestamp: 1 })
    expect(called).toBe(true)
  })
})
```

**Step 3: Run test to verify it fails**

Run: `cd ~/repos/assistant && bun test src/queue.test.ts`
Expected: FAIL — module `./queue` not found

**Step 4: Implement the queue**

```typescript
// src/queue.ts
import type { Signal } from "./types"

export type SignalQueue = {
  push(signal: Signal): void
  drain(): Signal[]
  onSignal(cb: () => void): void
}

export function createSignalQueue(): SignalQueue {
  let buffer: Signal[] = []
  let listener: (() => void) | null = null

  return {
    push(signal) {
      buffer.push(signal)
      listener?.()
    },
    drain() {
      const drained = buffer
      buffer = []
      return drained
    },
    onSignal(cb) {
      listener = cb
    },
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `cd ~/repos/assistant && bun test src/queue.test.ts`
Expected: all 4 tests PASS

**Step 6: Commit**

```bash
git add src/types.ts src/queue.ts src/queue.test.ts
git commit -m "feat: signal types and drain queue"
```

---

### Task 3: Status Board

**Files:**
- Create: `src/status-board.ts`
- Create: `src/status-board.test.ts`

**Step 1: Write the failing test**

The status board is shared mutable state that both agents read and write. For v1, it's in-memory.

```typescript
// src/status-board.test.ts
import { describe, test, expect } from "bun:test"
import { createStatusBoard } from "./status-board"

describe("StatusBoard", () => {
  test("starts with both agents idle", () => {
    const board = createStatusBoard()
    expect(board.get()).toEqual({
      conversation: { status: "idle", detail: null },
      heartbeat: { status: "idle", detail: null },
    })
  })

  test("update sets agent status", () => {
    const board = createStatusBoard()
    board.update("heartbeat", { status: "running", detail: "writing a recipe" })
    expect(board.get().heartbeat).toEqual({ status: "running", detail: "writing a recipe" })
    expect(board.get().conversation).toEqual({ status: "idle", detail: null })
  })

  test("format returns human-readable string", () => {
    const board = createStatusBoard()
    board.update("heartbeat", { status: "running", detail: "writing a recipe" })
    const text = board.format()
    expect(text).toContain("conversation: idle")
    expect(text).toContain("heartbeat: running — writing a recipe")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd ~/repos/assistant && bun test src/status-board.test.ts`
Expected: FAIL

**Step 3: Implement the status board**

```typescript
// src/status-board.ts
import type { AgentStatus, StatusBoard } from "./types"

export function createStatusBoard() {
  const state: StatusBoard = {
    conversation: { status: "idle", detail: null },
    heartbeat: { status: "idle", detail: null },
  }

  return {
    get(): StatusBoard {
      return { ...state }
    },
    update(agent: keyof StatusBoard, status: AgentStatus) {
      state[agent] = status
    },
    format(): string {
      const lines: string[] = []
      for (const [name, s] of Object.entries(state)) {
        const detail = s.detail ? ` — ${s.detail}` : ""
        lines.push(`${name}: ${s.status}${detail}`)
      }
      return lines.join("\n")
    },
  }
}
```

**Step 4: Run tests**

Run: `cd ~/repos/assistant && bun test src/status-board.test.ts`
Expected: all 3 tests PASS

**Step 5: Commit**

```bash
git add src/status-board.ts src/status-board.test.ts
git commit -m "feat: in-memory agent status board"
```

---

### Task 4: Database Schema and Conversation History

**Files:**
- Create: `src/db.ts`
- Create: `infra/docker-compose.yml`
- Create: `infra/init.sql`

**Step 1: Create docker-compose for Postgres**

```yaml
# infra/docker-compose.yml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: assistant
      POSTGRES_PASSWORD: assistant
      POSTGRES_DB: assistant
    ports:
      - "5434:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql

volumes:
  pgdata:
```

**Step 2: Create the schema**

```sql
-- infra/init.sql
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content JSONB NOT NULL,
  source TEXT NOT NULL,
  channel_id TEXT,
  agent TEXT NOT NULL DEFAULT 'conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_messages_agent ON messages(agent);
```

The `content` column stores a JSONB array of content blocks: `[{ "type": "text", "text": "..." }, ...]`

**Step 3: Start the database**

Run: `cd ~/repos/assistant && docker compose -f infra/docker-compose.yml up -d`
Expected: Postgres starts on port 5434

**Step 4: Create src/db.ts**

This module provides raw query access. No ORM — the agent can also query directly via bash/psql.

```typescript
// src/db.ts
import { Pool } from "pg"
import type { ContentBlock } from "./types"

let pool: Pool

export function initDb(databaseUrl: string) {
  pool = new Pool({ connectionString: databaseUrl })
}

export async function appendMessage(msg: {
  role: "user" | "assistant"
  content: ContentBlock[]
  source: string
  channelId?: string
  agent?: string
}) {
  await pool.query(
    `INSERT INTO messages (role, content, source, channel_id, agent) VALUES ($1, $2, $3, $4, $5)`,
    [msg.role, JSON.stringify(msg.content), msg.source, msg.channelId ?? null, msg.agent ?? "conversation"]
  )
}

export async function getRecentMessages(limit: number = 50): Promise<Array<{
  role: string
  content: ContentBlock[]
  source: string
  agent: string
  created_at: Date
}>> {
  const result = await pool.query(
    `SELECT role, content, source, agent, created_at FROM messages ORDER BY created_at DESC LIMIT $1`,
    [limit]
  )
  return result.rows.reverse()
}

export async function shutdown() {
  await pool.end()
}
```

**Step 5: Install pg**

Run: `cd ~/repos/assistant && bun add pg @types/pg`

**Step 6: Verify DB connection manually**

Run: `cd ~/repos/assistant && bun -e "import { Pool } from 'pg'; const p = new Pool({ connectionString: 'postgres://assistant:assistant@localhost:5434/assistant' }); const r = await p.query('SELECT 1'); console.log(r.rows); await p.end()"`
Expected: `[ { '?column?': 1 } ]`

**Step 7: Commit**

```bash
git add src/db.ts infra/docker-compose.yml infra/init.sql
git commit -m "feat: postgres schema and message persistence"
```

---

### Task 5: Context Pipeline

**Files:**
- Create: `src/context.ts`
- Create: `src/context.test.ts`

**Step 1: Write the failing test**

The context pipeline takes signals + state and produces a `Message[]` array suitable for llm-gateway's harness.

```typescript
// src/context.test.ts
import { describe, test, expect } from "bun:test"
import { buildContext } from "./context"
import type { Signal, StatusBoard } from "./types"

describe("buildContext", () => {
  const baseBoard: StatusBoard = {
    conversation: { status: "idle", detail: null },
    heartbeat: { status: "idle", detail: null },
  }

  test("message signal produces system + history + user message", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hello" }], timestamp: 1 }
    ]
    const history: Array<{ role: string; content: any[] }> = []

    const messages = buildContext({ signals, history, statusBoard: baseBoard })

    expect(messages[0]!.role).toBe("system")
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "hello",
    })
  })

  test("multiple drained messages become one user turn", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hey" }], timestamp: 1 },
      { type: "message", source: "discord", content: [{ type: "text", text: "whats up" }], timestamp: 2 },
    ]

    const messages = buildContext({ signals, history: [], statusBoard: baseBoard })
    const userMsgs = messages.filter((m) => m.role === "user")
    expect(userMsgs).toHaveLength(1)
    expect(userMsgs[0]!.content).toContain("hey")
    expect(userMsgs[0]!.content).toContain("whats up")
  })

  test("heartbeat signal produces reflection prompt", () => {
    const signals: Signal[] = [
      { type: "heartbeat", source: "cron", content: null, timestamp: 1 }
    ]

    const messages = buildContext({ signals, history: [], statusBoard: baseBoard })
    const userMsg = messages.find((m) => m.role === "user")
    expect(userMsg!.content).toContain("heartbeat")
  })

  test("status board is included in system prompt when agents are active", () => {
    const board: StatusBoard = {
      conversation: { status: "idle", detail: null },
      heartbeat: { status: "running", detail: "writing a recipe" },
    }
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 }
    ]

    const messages = buildContext({ signals, history: [], statusBoard: board })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("writing a recipe")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd ~/repos/assistant && bun test src/context.test.ts`
Expected: FAIL

**Step 3: Implement the context pipeline**

```typescript
// src/context.ts
import type { Signal, StatusBoard, ContentBlock } from "./types"

type Message = { role: "system" | "user" | "assistant"; content: string }

type BuildContextInput = {
  signals: Signal[]
  history: Array<{ role: string; content: ContentBlock[] }>
  statusBoard: StatusBoard
}

export function buildContext({ signals, history, statusBoard }: BuildContextInput): Message[] {
  const messages: Message[] = []

  // Stage 1: System prompt
  let systemPrompt = `You are a personal AI assistant. You run in the background and help your user with whatever they need. You have access to bash for executing commands, reading files, and querying databases.`

  // Stage 2: Status board (if any agent is active)
  const activeAgents = Object.entries(statusBoard).filter(([_, s]) => s.status === "running")
  if (activeAgents.length > 0) {
    const lines = activeAgents.map(([name, s]) => `- ${name}: ${s.detail ?? "working"}`).join("\n")
    systemPrompt += `\n\nYour other processes currently running:\n${lines}`
  }

  messages.push({ role: "system", content: systemPrompt })

  // Stage 3: Conversation history
  for (const msg of history) {
    const text = msg.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
    if (text) {
      messages.push({ role: msg.role as "user" | "assistant", content: text })
    }
  }

  // Stage 4: Trigger payload
  const signalType = signals[0]?.type

  if (signalType === "message") {
    const parts: string[] = []
    for (const sig of signals) {
      if (sig.content) {
        for (const block of sig.content) {
          if (block.type === "text") parts.push(block.text)
        }
      }
    }
    messages.push({ role: "user", content: parts.join("\n") })
  } else if (signalType === "heartbeat") {
    messages.push({
      role: "user",
      content: "This is a heartbeat signal. Reflect on recent conversations and your current state. Is there anything you should proactively do for the user? If not, simply respond with a brief internal note about your current state. If yes, take action.",
    })
  }

  return messages
}
```

**Step 4: Run tests**

Run: `cd ~/repos/assistant && bun test src/context.test.ts`
Expected: all 4 tests PASS

**Step 5: Commit**

```bash
git add src/context.ts src/context.test.ts
git commit -m "feat: context pipeline assembles messages from signals + state"
```

---

### Task 6: Discord Bot (Inbound + Outbound)

**Files:**
- Create: `src/discord.ts`

**Step 1: Implement the Discord channel**

This connects to Discord, emits signals into the queue on incoming messages, and exposes a `send` function for outbound messages. No test for this — it's a thin integration layer over discord.js.

```typescript
// src/discord.ts
import { Client, GatewayIntentBits, type TextChannel } from "discord.js"
import type { SignalQueue } from "./queue"
import type { ContentBlock } from "./types"

export type DiscordChannel = {
  start(): Promise<void>
  send(channelId: string, text: string): Promise<void>
  destroy(): void
}

export function createDiscordChannel(opts: {
  token: string
  allowedChannelIds: string[]
  queue: SignalQueue
}): DiscordChannel {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  })

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return
    if (!opts.allowedChannelIds.includes(message.channel.id)) return

    const content: ContentBlock[] = [{ type: "text", text: message.content }]

    // Handle attachments
    for (const attachment of message.attachments.values()) {
      if (attachment.contentType?.startsWith("image/")) {
        content.push({ type: "image", path: attachment.url, mimeType: attachment.contentType })
      } else {
        content.push({ type: "file", path: attachment.url, filename: attachment.name ?? "file" })
      }
    }

    opts.queue.push({
      type: "message",
      source: "discord",
      content,
      channelId: message.channel.id,
      metadata: { userId: message.author.id, username: message.author.username },
      timestamp: Date.now(),
    })
  })

  return {
    async start() {
      await client.login(opts.token)
      console.log(`discord bot logged in as ${client.user?.tag}`)
    },
    async send(channelId: string, text: string) {
      const channel = await client.channels.fetch(channelId) as TextChannel
      // Discord has a 2000 char limit per message
      const chunks = splitMessage(text, 2000)
      for (const chunk of chunks) {
        await channel.send(chunk)
      }
    },
    destroy() {
      client.destroy()
    },
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen))
    remaining = remaining.slice(maxLen)
  }
  return chunks
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd ~/repos/assistant && bunx tsc --noEmit`
Expected: no errors (or only errors from unresolved llm-gateway imports, which is OK at this stage)

**Step 3: Commit**

```bash
git add src/discord.ts
git commit -m "feat: discord bot inbound signals and outbound messaging"
```

---

### Task 7: Core Loop — Conversation Agent

**Files:**
- Create: `src/conversation-agent.ts`

This is the heart of the system. It watches the queue, drains signals, builds context, invokes the llm-gateway harness, streams output to Discord, and persists the conversation.

**Step 1: Implement the conversation agent loop**

Note: This imports from llm-gateway. The exact import paths depend on how llm-gateway exports its modules. The `link:../llm-gateway` dependency means we import from `llm-gateway/packages/ai/...` or however the package exports are configured. Verify the actual export paths before writing code — check `~/repos/llm-gateway/package.json` for `exports` field.

```typescript
// src/conversation-agent.ts
import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/anthropic"
import { bashTool } from "llm-gateway/packages/ai/tools/bash"
import { buildContext } from "./context"
import { appendMessage, getRecentMessages } from "./db"
import type { SignalQueue } from "./queue"
import type { DiscordChannel } from "./discord"
import type { ContentBlock } from "./types"

type ConversationAgentOpts = {
  queue: SignalQueue
  discord: DiscordChannel
  statusBoard: ReturnType<typeof import("./status-board").createStatusBoard>
  model: string
}

export function startConversationAgent(opts: ConversationAgentOpts) {
  const { queue, discord, statusBoard, model } = opts
  let running = false

  async function runOnce() {
    const signals = queue.drain()
    if (signals.length === 0) return

    running = true
    statusBoard.update("conversation", { status: "running", detail: "responding to user" })

    try {
      // Determine which channel to respond to
      const channelId = signals.find((s) => s.channelId)?.channelId

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

      // Build context
      const history = await getRecentMessages(50)
      const messages = buildContext({ signals, history, statusBoard: statusBoard.get() })

      // Create harness and run agent
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

      // Collect assistant response and stream to Discord
      let fullText = ""
      for await (const { event } of orchestrator.events()) {
        if (event.type === "text") {
          fullText += event.content
        }
        if (event.type === "error") {
          console.error("agent error:", event.error)
        }
      }

      // Send response to Discord
      if (fullText && channelId) {
        await discord.send(channelId, fullText)
      }

      // Persist assistant response
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
    }

    // Check if more messages arrived while we were running
    if (queue.drain().length > 0) {
      // Put them back — actually, drain already took them.
      // This is handled by the onSignal listener triggering another run.
    }
  }

  // When a signal arrives and we're not running, start a run
  queue.onSignal(() => {
    if (!running) {
      runOnce()
    }
  })

  return { runOnce }
}
```

**Step 2: Verify TypeScript compiles (may need to adjust imports)**

Run: `cd ~/repos/assistant && bunx tsc --noEmit`
Adapt import paths based on what llm-gateway actually exports.

**Step 3: Commit**

```bash
git add src/conversation-agent.ts
git commit -m "feat: conversation agent — queue drain, context build, harness invoke, discord reply"
```

---

### Task 8: Heartbeat Agent

**Files:**
- Create: `src/heartbeat-agent.ts`

**Step 1: Implement the heartbeat agent**

Similar to conversation agent but triggered by a timer, and it decides whether to act or not.

```typescript
// src/heartbeat-agent.ts
import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/anthropic"
import { bashTool } from "llm-gateway/packages/ai/tools/bash"
import { buildContext } from "./context"
import { getRecentMessages } from "./db"
import type { DiscordChannel } from "./discord"
import type { Signal } from "./types"

type HeartbeatAgentOpts = {
  discord: DiscordChannel
  statusBoard: ReturnType<typeof import("./status-board").createStatusBoard>
  model: string
  intervalMs: number
  defaultChannelId: string
}

export function startHeartbeatAgent(opts: HeartbeatAgentOpts) {
  const { discord, statusBoard, model, intervalMs, defaultChannelId } = opts
  let running = false
  let timer: ReturnType<typeof setInterval>

  async function tick() {
    if (running) return // skip if already running

    running = true
    statusBoard.update("heartbeat", { status: "running", detail: "reflecting on recent activity" })

    try {
      const signal: Signal = {
        type: "heartbeat",
        source: "cron",
        content: null,
        timestamp: Date.now(),
      }

      const history = await getRecentMessages(50)
      const messages = buildContext({ signals: [signal], history, statusBoard: statusBoard.get() })

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

      // If the agent produced output, send it to Discord
      if (fullText && !fullText.toLowerCase().includes("[no action needed]")) {
        await discord.send(defaultChannelId, fullText)
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

**Step 2: Commit**

```bash
git add src/heartbeat-agent.ts
git commit -m "feat: heartbeat agent — periodic reflection and proactive action"
```

---

### Task 9: Wire Everything Together in main.ts

**Files:**
- Modify: `src/main.ts`

**Step 1: Write the main entry point**

```typescript
// src/main.ts
import { createSignalQueue } from "./queue"
import { createStatusBoard } from "./status-board"
import { createDiscordChannel } from "./discord"
import { startConversationAgent } from "./conversation-agent"
import { startHeartbeatAgent } from "./heartbeat-agent"
import { initDb, shutdown as shutdownDb } from "./db"

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID!
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://assistant:assistant@localhost:5434/assistant"
const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "claude-sonnet-4-20250514"
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 1800000)

async function main() {
  console.log("assistant starting...")

  // Initialize DB
  initDb(DATABASE_URL)
  console.log("database connected")

  // Create shared primitives
  const queue = createSignalQueue()
  const statusBoard = createStatusBoard()

  // Start Discord bot
  const discord = createDiscordChannel({
    token: DISCORD_BOT_TOKEN,
    allowedChannelIds: [DISCORD_CHANNEL_ID],
    queue,
  })
  await discord.start()
  console.log("discord bot online")

  // Start conversation agent
  startConversationAgent({
    queue,
    discord,
    statusBoard,
    model: DEFAULT_MODEL,
  })
  console.log("conversation agent ready")

  // Start heartbeat agent
  const heartbeat = startHeartbeatAgent({
    discord,
    statusBoard,
    model: DEFAULT_MODEL,
    intervalMs: HEARTBEAT_INTERVAL_MS,
    defaultChannelId: DISCORD_CHANNEL_ID,
  })
  console.log(`heartbeat agent ready (interval: ${HEARTBEAT_INTERVAL_MS}ms)`)

  // Graceful shutdown
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

**Step 2: Verify TypeScript compiles**

Run: `cd ~/repos/assistant && bunx tsc --noEmit`
Fix any import path issues.

**Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: main entry point wiring all components together"
```

---

### Task 10: End-to-End Test

**Files:** none new — this is a manual integration test

**Step 1: Start infrastructure**

Run: `cd ~/repos/assistant && docker compose -f infra/docker-compose.yml up -d`

**Step 2: Create a `.env` file**

Copy `.env.example` to `.env` and fill in `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID`. Set `HEARTBEAT_INTERVAL_MS=60000` (1 minute) for testing.

**Step 3: Start the assistant**

Run: `cd ~/repos/assistant && bun run dev`

**Step 4: Send a Discord message**

Send "hello" in the configured Discord channel. Verify:
- The bot logs that it received a signal
- The agent runs and produces a response
- The response appears in Discord
- The message is persisted in Postgres: `psql postgres://assistant:assistant@localhost:5434/assistant -c "SELECT role, content, source FROM messages ORDER BY created_at DESC LIMIT 5"`

**Step 5: Wait for a heartbeat**

Wait 1 minute. Verify:
- The heartbeat agent fires
- It either takes action or stays quiet
- Status board updates are logged

**Step 6: Send multiple rapid messages**

Send 3 messages quickly in Discord. Verify:
- They accumulate in the queue
- The agent responds to all of them in one turn

**Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end testing"
```

---

## Out of Scope for V1

- Multimodal output (images, files sent back to Discord)
- Downloading Discord attachments to local filesystem (v1 stores URLs)
- Multiple Discord channels/DMs
- CLI channel
- Web channel
- SMS channel
- Vector store / semantic memory
- Context pipeline LLM stages
- Conversation summarization
- Persistent status board (in-memory only for v1)
- Agent spawning subagents
