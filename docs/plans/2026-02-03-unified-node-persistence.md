# Unified Node Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store full agent output (reasoning, text, tool calls, tool results, usage, errors) as llm-gateway `Node[]` instead of text-only `ContentBlock[]`, and unify user messages to the same format.

**Architecture:** A shared `collectAgentOutput()` function consumes orchestrator events via llm-gateway's graph reducer, returning consolidated `Node[]`. Both agents use it. Discord rendering hooks in via an `onEvent` callback. User messages are stored as `Node[]` with `kind: "user"` nodes. The local `ContentBlock` type is deleted entirely.

**Tech Stack:** llm-gateway (graph reducer, `Node` type, `ContentPart`), Bun, PostgreSQL (JSONB)

---

### Task 1: Create `collectAgentOutput` function

The shared function that both agents will use to consume orchestrator events and produce `Node[]`.

**Files:**
- Create: `src/collect.ts`
- Test: `src/collect.test.ts`

**Step 1: Write the failing test**

```typescript
// src/collect.test.ts
import { describe, test, expect } from "bun:test"
import { collectAgentOutput } from "./collect"
import type { ConsumerHarnessEvent } from "llm-gateway/packages/ai/orchestrator"

type OrchestratorEvent = { agentId: string; event: ConsumerHarnessEvent }

async function* makeEvents(events: OrchestratorEvent[]): AsyncIterable<OrchestratorEvent> {
  for (const e of events) yield e
}

describe("collectAgentOutput", () => {
  test("collects text nodes from events", async () => {
    const events = makeEvents([
      { agentId: "a1", event: { type: "harness_start", runId: "r1" } },
      { agentId: "a1", event: { type: "text", runId: "r1", id: "t1", content: "hello " } },
      { agentId: "a1", event: { type: "text", runId: "r1", id: "t1", content: "world" } },
      { agentId: "a1", event: { type: "harness_end", runId: "r1" } },
    ])

    const nodes = await collectAgentOutput(events)
    const textNodes = nodes.filter((n) => n.kind === "text")
    expect(textNodes).toHaveLength(1)
    expect(textNodes[0]!.content).toBe("hello world")
  })

  test("collects reasoning nodes", async () => {
    const events = makeEvents([
      { agentId: "a1", event: { type: "harness_start", runId: "r1" } },
      { agentId: "a1", event: { type: "reasoning", runId: "r1", id: "r1r", content: "thinking..." } },
      { agentId: "a1", event: { type: "text", runId: "r1", id: "t1", content: "answer" } },
      { agentId: "a1", event: { type: "harness_end", runId: "r1" } },
    ])

    const nodes = await collectAgentOutput(events)
    const reasoning = nodes.filter((n) => n.kind === "reasoning")
    expect(reasoning).toHaveLength(1)
    expect(reasoning[0]!.content).toBe("thinking...")
  })

  test("collects tool_call and tool_result nodes", async () => {
    const events = makeEvents([
      { agentId: "a1", event: { type: "harness_start", runId: "r1" } },
      { agentId: "a1", event: { type: "tool_call", runId: "r1", id: "tc1", name: "bash", input: { cmd: "ls" } } },
      { agentId: "a1", event: { type: "tool_result", runId: "r1", id: "tc1", name: "bash", output: "file.txt" } },
      { agentId: "a1", event: { type: "harness_end", runId: "r1" } },
    ])

    const nodes = await collectAgentOutput(events)
    const calls = nodes.filter((n) => n.kind === "tool_call")
    const results = nodes.filter((n) => n.kind === "tool_result")
    expect(calls).toHaveLength(1)
    expect(calls[0]!.name).toBe("bash")
    expect(results).toHaveLength(1)
    expect(results[0]!.output).toBe("file.txt")
  })

  test("filters out harness_start and harness_end nodes", async () => {
    const events = makeEvents([
      { agentId: "a1", event: { type: "harness_start", runId: "r1" } },
      { agentId: "a1", event: { type: "text", runId: "r1", id: "t1", content: "hi" } },
      { agentId: "a1", event: { type: "harness_end", runId: "r1" } },
    ])

    const nodes = await collectAgentOutput(events)
    const lifecycle = nodes.filter((n) => n.kind === "harness_start" || n.kind === "harness_end")
    expect(lifecycle).toHaveLength(0)
  })

  test("calls onEvent callback for each event", async () => {
    const seen: string[] = []
    const events = makeEvents([
      { agentId: "a1", event: { type: "harness_start", runId: "r1" } },
      { agentId: "a1", event: { type: "text", runId: "r1", id: "t1", content: "hi" } },
      { agentId: "a1", event: { type: "harness_end", runId: "r1" } },
    ])

    await collectAgentOutput(events, (event) => {
      seen.push(event.type)
    })

    expect(seen).toEqual(["harness_start", "text", "harness_end"])
  })

  test("collects error nodes", async () => {
    const events = makeEvents([
      { agentId: "a1", event: { type: "harness_start", runId: "r1" } },
      { agentId: "a1", event: { type: "error", runId: "r1", error: new Error("something broke") } },
      { agentId: "a1", event: { type: "harness_end", runId: "r1" } },
    ])

    const nodes = await collectAgentOutput(events)
    const errors = nodes.filter((n) => n.kind === "error")
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toBe("something broke")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/collect.test.ts`
Expected: FAIL — `collect.ts` does not exist

**Step 3: Write minimal implementation**

```typescript
// src/collect.ts
import { createGraph, reduceEvent } from "llm-gateway/packages/ai/client"
import type { Graph, Node } from "llm-gateway/packages/ai/client"
import type { ConsumerHarnessEvent } from "llm-gateway/packages/ai/orchestrator"

type OrchestratorEvent = { agentId: string; event: ConsumerHarnessEvent }

const LIFECYCLE_KINDS = new Set(["harness_start", "harness_end"])

function toGraphEvent(event: ConsumerHarnessEvent, agentId: string) {
  if (event.type === "error") {
    return { ...event, type: "error" as const, message: event.error.message, agentId }
  }
  return { ...event, agentId }
}

export async function collectAgentOutput(
  events: AsyncIterable<OrchestratorEvent>,
  onEvent?: (event: ConsumerHarnessEvent, graph: Graph) => void,
): Promise<Node[]> {
  let graph: Graph = createGraph()

  for await (const { agentId, event } of events) {
    const graphEvent = toGraphEvent(event, agentId)
    graph = reduceEvent(graph, graphEvent)
    onEvent?.(event, graph)
  }

  return Array.from(graph.nodes.values()).filter((n) => !LIFECYCLE_KINDS.has(n.kind))
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/collect.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/collect.ts src/collect.test.ts
git commit -m "feat: add collectAgentOutput for unified event-to-node reduction"
```

---

### Task 2: Replace `ContentBlock` with `Node` in `types.ts` and `db.ts`

Delete the local `ContentBlock` type and update `appendMessage` / `getSessionMessages` to use llm-gateway's `Node[]`.

**Files:**
- Modify: `src/types.ts:10-13` (delete `ContentBlock`)
- Modify: `src/db.ts:2,21,40` (switch from `ContentBlock` to `Node`)
- Modify: `src/db.test.ts` (update test data to use `Node` shape)

**Step 1: Update `src/types.ts` — delete `ContentBlock`**

Remove the `ContentBlock` type entirely. The `Signal` type will be updated in Task 4 — for now just delete `ContentBlock`:

```typescript
// src/types.ts — after edit
export type Signal = {
  type: "message" | "heartbeat"
  source: string
  content: ContentPart[] | null  // changed from ContentBlock[]
  channelId?: string
  metadata?: Record<string, unknown>
  timestamp: number
}

// ContentBlock is DELETED

export type AgentStatus = {
  status: "idle" | "running"
  detail: string | null
}

export type StatusBoard = {
  conversation: AgentStatus
  heartbeat: AgentStatus
}

export type StatusBoardInstance = {
  get(): StatusBoard
  update(agent: keyof StatusBoard, status: AgentStatus): Promise<void>
  format(): string
}
```

Add the `ContentPart` import at top:

```typescript
import type { ContentPart } from "llm-gateway/packages/ai/types"
```

**Step 2: Update `src/db.ts` — switch to `Node[]`**

Replace the `ContentBlock` import with `Node` from llm-gateway. Update `appendMessage` and `getSessionMessages`:

```typescript
// src/db.ts — line 1-2
import { Pool } from "pg"
import type { Node } from "llm-gateway/packages/ai/client"
```

In `appendMessage`, change `content: ContentBlock[]` to `content: Node[]` (line 21).

In `getSessionMessages`, change return type from `ContentBlock[]` to `Node[]` (line 40).

**Step 3: Update `src/db.test.ts` — use Node shape in test data**

Replace all `{ type: "text", text: "..." }` content blocks with `{ id: "test", runId: "r1", kind: "user", content: "..." }` nodes. Example:

```typescript
// Before:
content: [{ type: "text", text: "hello session" }]

// After:
content: [{ id: "u1", runId: "r1", kind: "user" as const, content: "hello session" }]
```

Update assertions too:
```typescript
// Before:
expect(msgs1[0]!.content[0]).toEqual({ type: "text", text: "session 1 msg" })

// After:
expect(msgs1[0]!.content[0]).toMatchObject({ kind: "user", content: "session 1 msg" })
```

**Step 4: Run tests to verify**

Run: `bun test src/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/db.ts src/db.test.ts
git commit -m "refactor: replace ContentBlock with llm-gateway Node for message persistence"
```

---

### Task 3: Update heartbeat agent to use `collectAgentOutput`

Replace the manual `fullText +=` event loop with the shared `collectAgentOutput` function.

**Files:**
- Modify: `src/heartbeat-agent.ts:1-13,62-80`

**Step 1: Update imports**

Remove the `ContentBlock` import. Add `collectAgentOutput` import:

```typescript
import { collectAgentOutput } from "./collect"
```

**Step 2: Replace the event loop**

Replace lines 62-80 (the `let fullText = ""` block through `appendMessage`) with:

```typescript
const nodes = await collectAgentOutput(orchestrator.events())

if (nodes.length > 0) {
  await appendMessage({
    role: "assistant",
    content: nodes,
    source: "heartbeat",
    agent: "heartbeat",
  })
}
```

**Step 3: Run tests**

Run: `bun test src/heartbeat-agent.test.ts`
Expected: PASS (only tests `computeStartDelay`, not the event loop)

**Step 4: Commit**

```bash
git add src/heartbeat-agent.ts
git commit -m "refactor: heartbeat agent uses collectAgentOutput for full node persistence"
```

---

### Task 4: Update conversation agent to use `collectAgentOutput`

Replace the dual event consumption paths (Discord streaming / manual loop) with `collectAgentOutput` + `onEvent` callback for Discord.

**Files:**
- Modify: `src/conversation-agent.ts:1-12,74-100`
- Modify: `src/discord.ts:72-76,149-223` (change `streamResponse` to accept an `onEvent` callback pattern instead of owning the event loop)

**Step 1: Refactor `discord.ts` — replace `streamResponse` with `createStreamRenderer`**

The Discord channel no longer owns the event iteration. Instead, expose a function that returns an `onEvent` callback:

```typescript
// In the DiscordChannel type, replace:
//   streamResponse(channelId: string, events: AsyncIterable<OrchestratorEvent>): Promise<string>
// with:
  createStreamRenderer(channelId: string): {
    onEvent: (event: ConsumerHarnessEvent, graph: Graph) => void
    flush: () => Promise<void>
  }
```

Implementation — extract the rendering logic from `streamResponse` into `createStreamRenderer`:

```typescript
createStreamRenderer(channelId: string) {
  let msg: Message | null = null
  let hasUnsentReasoning = false
  let pendingRender: string | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let channelRef: DMChannel | null = null

  // Lazily fetch channel
  const getChannel = async () => {
    if (!channelRef) {
      const ch = await client.channels.fetch(channelId)
      if (!ch?.isTextBased()) throw new Error("Channel not text-based")
      channelRef = ch as DMChannel
    }
    return channelRef
  }

  const flushUpdate = async () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (!pendingRender) return
    const content = pendingRender
    pendingRender = null
    const ch = await getChannel()
    const chunks = splitMessage(content, 1500)
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      if (i === 0) {
        if (!msg) {
          msg = await ch.send(chunk)
        } else {
          await msg.edit(chunk).catch(console.error)
        }
      } else {
        await ch.send(chunk)
      }
    }
  }

  const scheduleUpdate = (rendered: string) => {
    pendingRender = rendered
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(flushUpdate, 1000)
  }

  return {
    onEvent(event: ConsumerHarnessEvent, graph: Graph) {
      if (event.type === "reasoning") {
        hasUnsentReasoning = true
        return
      }

      const shouldUpdate =
        UPDATE_EVENTS.has(event.type) ||
        (hasUnsentReasoning && (event.type === "text" || event.type === "tool_call"))

      if (hasUnsentReasoning && (event.type === "text" || event.type === "tool_call")) {
        hasUnsentReasoning = false
      }

      if (!shouldUpdate) return

      const viewNodes = projectThread(graph)
      const rendered = renderViewNodes(viewNodes)
      if (rendered) scheduleUpdate(rendered)
    },
    async flush(graph: Graph) {
      const viewNodes = projectThread(graph)
      const finalRendered = renderViewNodes(viewNodes)
      if (finalRendered) {
        pendingRender = finalRendered
        await flushUpdate()
      }
    },
  }
},
```

Update the `DiscordChannel` type and remove the old `streamResponse` method. Remove the `extractFinalText` function (no longer needed — persistence uses nodes, not extracted text). Remove the `OrchestratorEvent` type alias (moved to `collect.ts`).

**Step 2: Update `conversation-agent.ts` — use `collectAgentOutput` with Discord callback**

```typescript
import { collectAgentOutput } from "./collect"

// Replace lines 74-100 with:
const renderer = channelId ? discord.createStreamRenderer(channelId) : null

const nodes = await collectAgentOutput(
  orchestrator.events(),
  renderer?.onEvent,
)

if (renderer) {
  await renderer.flush(/* need graph — see note */)
}

if (nodes.length > 0) {
  await appendMessage({
    role: "assistant",
    content: nodes,
    source: "conversation",
    agent: "conversation",
    sessionId,
  })
}
```

**Note:** The `flush` method needs the final graph. Two options:
- (a) Have `collectAgentOutput` return `{ nodes, graph }` — simple, no API change to onEvent
- (b) The renderer tracks the graph internally from onEvent calls (it already receives it)

Option (b) is cleaner — the renderer already receives the graph on every `onEvent` call, so it can just track the latest one internally and `flush()` takes no argument:

```typescript
// Inside createStreamRenderer:
let latestGraph: Graph = createGraph()

return {
  onEvent(event, graph) {
    latestGraph = graph
    // ... rendering logic
  },
  async flush() {
    const viewNodes = projectThread(latestGraph)
    // ...
  },
}
```

Remove the `ContentBlock` import from `conversation-agent.ts`.

**Step 3: Run all tests**

Run: `bun test`
Expected: PASS (conversation agent has no unit tests, but db/context/heartbeat tests should pass)

**Step 4: Commit**

```bash
git add src/discord.ts src/conversation-agent.ts
git commit -m "refactor: conversation agent uses collectAgentOutput with Discord renderer callback"
```

---

### Task 5: Update Signal type and Discord inbound to use `ContentPart`

Change Signal to carry `ContentPart[]` instead of the deleted `ContentBlock[]`. Update Discord message handler to produce `ContentPart[]`.

**Files:**
- Modify: `src/types.ts:1-8` (Signal.content type)
- Modify: `src/discord.ts:100-134` (messageCreate handler)
- Modify: `src/context.ts:1,8,71-97` (history/signal content handling)
- Modify: `src/context.test.ts` (update test data)
- Modify: `src/conversation-agent.ts:41-53` (user message persistence — wrap ContentPart[] in a user Node)

**Step 1: Update context.test.ts with new content shapes**

Replace all `[{ type: "text", text: "..." }]` in signal content with `ContentPart[]`:

```typescript
// Before:
content: [{ type: "text", text: "hello" }]

// After (ContentPart[] — same shape, just different type context):
content: [{ type: "text", text: "hello" }]
```

`ContentPart`'s text variant is `{ type: "text"; text: string }` — same shape as the old `ContentBlock` text variant. So test data for text-only signals doesn't change. But the type import and history content do change.

For history content (which is now `Node[]`), update:

```typescript
// Before:
const history = [
  { role: "user", content: [{ type: "text" as const, text: "earlier message" }], created_at: ts },
  { role: "assistant", content: [{ type: "text" as const, text: "earlier reply" }], created_at: ts },
]

// After:
const history = [
  { role: "user", content: [{ id: "u1", runId: "r1", kind: "user" as const, content: "earlier message" }], created_at: ts },
  { role: "assistant", content: [{ id: "t1", runId: "r1", kind: "text" as const, content: "earlier reply" }], created_at: ts },
]
```

**Step 2: Update `src/context.ts` — handle `Node[]` history and `ContentPart[]` signals**

Replace `ContentBlock` import with `Node` and `ContentPart`:

```typescript
import type { Node } from "llm-gateway/packages/ai/client"
import type { ContentPart } from "llm-gateway/packages/ai/types"
```

Update `ConversationContextInput.history` content type from `ContentBlock[]` to `Node[]`.

Update the history loop (lines 70-78) to extract text from `Node[]`:

```typescript
for (const msg of history) {
  const text = msg.content
    .filter((n): n is Node & { kind: "text" } => n.kind === "text")
    .map((n) => n.content)
    .join("\n")
  if (text) {
    const content = msg.role === "user" ? `[${msg.created_at.toISOString()}]\n${text}` : text
    messages.push({ role: msg.role as "user" | "assistant", content })
  }
}
```

Update the signal processing loop (lines 85-97) to extract text from `ContentPart[]`:

```typescript
for (const sig of signals) {
  if (sig.content) {
    for (const part of sig.content) {
      if (part.type === "text") {
        if (sig.type === "heartbeat") {
          heartbeatParts.push(part.text)
        } else {
          userParts.push(part.text)
        }
      }
    }
  }
}
```

(Signal loop code is the same since `ContentPart` text has the same `{ type: "text", text: string }` shape — but the type import changes.)

**Step 3: Update Discord inbound — produce `ContentPart[]`**

In `discord.ts` messageCreate handler, the content array construction changes from `ContentBlock[]` to `ContentPart[]`. For text, the shape is identical. For images, fetch the URL and base64-encode:

```typescript
const content: ContentPart[] = []

if (message.content) {
  content.push({ type: "text", text: message.content })
}

for (const attachment of message.attachments.values()) {
  if (attachment.contentType?.startsWith("image/")) {
    const res = await fetch(attachment.url)
    const buf = Buffer.from(await res.arrayBuffer())
    content.push({
      type: "image",
      mediaType: attachment.contentType,
      data: buf.toString("base64"),
    })
  }
  // Non-image attachments: skip for now (document support can be added later)
}
```

Remove the `ContentBlock` import, add `ContentPart` import.

**Step 4: Update `conversation-agent.ts` — wrap user content in Node for persistence**

When persisting inbound user messages, wrap the `ContentPart[]` in a user `Node`:

```typescript
for (const sig of signals) {
  if (sig.content) {
    const userNode: Node = {
      id: `user-${Date.now()}`,
      runId: `signal-${sig.timestamp}`,
      kind: "user",
      content: sig.content.length === 1 && sig.content[0]!.type === "text"
        ? sig.content[0]!.text
        : sig.content,
    }
    await appendMessage({
      role: "user",
      content: [userNode],
      source: sig.source,
      channelId: sig.channelId,
      agent: "conversation",
      sessionId,
    })
  }
}
```

**Step 5: Run all tests**

Run: `bun test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/types.ts src/discord.ts src/context.ts src/context.test.ts src/conversation-agent.ts
git commit -m "refactor: unify Signal content to ContentPart[], persist user messages as Node[]"
```

---

### Task 6: Add `nodesToMessages` projection for LLM context

Convert persisted `Node[]` back to llm-gateway `Message[]` for feeding history into the LLM. This replaces the current text-only extraction in `context.ts`.

**Files:**
- Create: `src/projection.ts`
- Test: `src/projection.test.ts`
- Modify: `src/context.ts:70-78` (use projection instead of manual text extraction)

**Step 1: Write the failing test**

```typescript
// src/projection.test.ts
import { describe, test, expect } from "bun:test"
import { nodesToMessages } from "./projection"
import type { Node } from "llm-gateway/packages/ai/client"

describe("nodesToMessages", () => {
  test("converts text nodes to assistant message", () => {
    const nodes: Node[] = [
      { id: "t1", runId: "r1", kind: "text", content: "hello world" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toEqual([
      { role: "assistant", content: "hello world" },
    ])
  })

  test("converts tool_call and tool_result to assistant + tool messages", () => {
    const nodes: Node[] = [
      { id: "tc1", runId: "r1", kind: "tool_call", name: "bash", input: { cmd: "ls" } },
      { id: "tc1:result", runId: "r1", kind: "tool_result", name: "bash", output: "file.txt" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "tc1", name: "bash", arguments: { cmd: "ls" } }] },
      { role: "tool", tool_call_id: "tc1", content: "file.txt" },
    ])
  })

  test("converts user nodes to user messages", () => {
    const nodes: Node[] = [
      { id: "u1", runId: "r1", kind: "user", content: "what time is it?" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toEqual([
      { role: "user", content: "what time is it?" },
    ])
  })

  test("skips reasoning nodes", () => {
    const nodes: Node[] = [
      { id: "r1r", runId: "r1", kind: "reasoning", content: "let me think..." },
      { id: "t1", runId: "r1", kind: "text", content: "answer" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!).toEqual({ role: "assistant", content: "answer" })
  })

  test("skips usage and error nodes", () => {
    const nodes: Node[] = [
      { id: "r1:usage:1", runId: "r1", kind: "usage", inputTokens: 100, outputTokens: 50 },
      { id: "r1:error", runId: "r1", kind: "error", message: "oops" },
      { id: "t1", runId: "r1", kind: "text", content: "recovered" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toHaveLength(1)
  })

  test("groups adjacent text into single assistant message", () => {
    const nodes: Node[] = [
      { id: "t1", runId: "r1", kind: "text", content: "first" },
      { id: "t2", runId: "r1", kind: "text", content: "second" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toEqual([
      { role: "assistant", content: "first\nsecond" },
    ])
  })

  test("tool_call between text creates separate assistant messages", () => {
    const nodes: Node[] = [
      { id: "t1", runId: "r1", kind: "text", content: "before" },
      { id: "tc1", runId: "r1", kind: "tool_call", name: "bash", input: "ls" },
      { id: "tc1:result", runId: "r1", kind: "tool_result", name: "bash", output: "files" },
      { id: "t2", runId: "r1", kind: "text", content: "after" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toHaveLength(4)
    expect(msgs[0]).toEqual({ role: "assistant", content: "before" })
    expect(msgs[1]).toEqual({ role: "assistant", content: null, tool_calls: [{ id: "tc1", name: "bash", arguments: "ls" }] })
    expect(msgs[2]).toEqual({ role: "tool", tool_call_id: "tc1", content: "files" })
    expect(msgs[3]).toEqual({ role: "assistant", content: "after" })
  })

  test("user nodes with ContentPart[] preserve structured content", () => {
    const nodes: Node[] = [
      { id: "u1", runId: "r1", kind: "user", content: [
        { type: "text", text: "what is this?" },
        { type: "image", mediaType: "image/png", data: "base64..." },
      ]},
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toEqual([
      { role: "user", content: [
        { type: "text", text: "what is this?" },
        { type: "image", mediaType: "image/png", data: "base64..." },
      ]},
    ])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/projection.test.ts`
Expected: FAIL — `projection.ts` does not exist

**Step 3: Write minimal implementation**

```typescript
// src/projection.ts
import type { Node } from "llm-gateway/packages/ai/client"
import type { Message } from "llm-gateway/packages/ai/types"

const SKIP_KINDS = new Set(["reasoning", "usage", "error", "harness_start", "harness_end", "relay"])

export function nodesToMessages(nodes: Node[]): Message[] {
  const messages: Message[] = []
  let pendingText: string[] = []

  function flushText() {
    if (pendingText.length > 0) {
      messages.push({ role: "assistant", content: pendingText.join("\n") })
      pendingText = []
    }
  }

  for (const node of nodes) {
    if (SKIP_KINDS.has(node.kind)) continue

    switch (node.kind) {
      case "text":
        pendingText.push(node.content)
        break

      case "tool_call":
        flushText()
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [{ id: node.id, name: node.name, arguments: node.input }],
        })
        break

      case "tool_result":
        flushText()
        messages.push({
          role: "tool",
          tool_call_id: node.id.replace(/:result$/, ""),
          content: typeof node.output === "string" ? node.output : JSON.stringify(node.output),
        })
        break

      case "user":
        flushText()
        messages.push({ role: "user", content: node.content })
        break
    }
  }

  flushText()
  return messages
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/projection.test.ts`
Expected: PASS

**Step 5: Integrate into `context.ts`**

Replace the history loop in `buildConversationContext` (lines 70-78) with:

```typescript
import { nodesToMessages } from "./projection"

// Replace the history extraction loop with:
for (const msg of history) {
  const projected = nodesToMessages(msg.content)
  for (const m of projected) {
    if (m.role === "user" && typeof m.content === "string") {
      messages.push({ role: "user", content: `[${msg.created_at.toISOString()}]\n${m.content}` })
    } else {
      messages.push(m as { role: "user" | "assistant" | "system"; content: string })
    }
  }
}
```

Note: The context `Message` type is currently `{ role: "system" | "user" | "assistant"; content: string }`. This will need to be expanded to llm-gateway's `Message` type to support tool messages and `ContentPart[]`. Update the local `Message` type alias at line 4:

```typescript
import type { Message } from "llm-gateway/packages/ai/types"
```

And remove the local `Message` type alias.

**Step 6: Run all tests**

Run: `bun test`
Expected: PASS

**Step 7: Commit**

```bash
git add src/projection.ts src/projection.test.ts src/context.ts
git commit -m "feat: add nodesToMessages projection, feed full history to LLM context"
```

---

### Task 7: Clean up — remove all remaining `ContentBlock` references

Search for any remaining references to `ContentBlock` and remove them.

**Step 1: Search for remaining references**

Run: `grep -r "ContentBlock" src/`

Remove any remaining imports or usages. At this point the only legitimate content types should be:
- `Node` (from `llm-gateway/packages/ai/client`) — for persistence
- `ContentPart` (from `llm-gateway/packages/ai/types`) — for user input in signals
- `Message` (from `llm-gateway/packages/ai/types`) — for LLM context

**Step 2: Run full test suite**

Run: `bun test`
Expected: PASS — all tests green

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove all ContentBlock references"
```
