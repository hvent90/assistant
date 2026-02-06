# Heartbeat Speak Tool

## Problem

Heartbeat currently sends messages directly to Discord. This bypasses the conversation agent, creating two different "voices" for the assistant. It also requires brittle `[no action needed]` string matching to decide whether to send.

## Design

Give heartbeat a `speak()` tool that pushes a signal to the conversation queue. Conversation agent handles the actual user communication, maintaining a unified voice. Heartbeat retains full agency — it decides *whether* and *what* to communicate.

### Flow

```
heartbeat tick
    ↓
heartbeat agent runs (thinks aloud, uses tools)
    ↓
wants to communicate? → calls speak({ thought: "I should check in about..." })
    ↓
speak() pushes signal to conversation queue (type: "heartbeat")
    ↓
conversation agent picks up signal
    ↓
thought appears as role: "assistant" (its own prior reasoning)
    ↓
conversation agent formulates response → sends to Discord
```

### Key decisions

1. **Tool-based intent** — No magic strings. Heartbeat calls `speak()` when it wants to communicate, doesn't call it when it doesn't.

2. **Fire-and-forget** — Heartbeat doesn't wait for conversation agent. Pushes signal and continues/finishes.

3. **Thought as assistant message** — The heartbeat's thought appears as `role: "assistant"` in conversation context, not `role: "user"` or `role: "system"`. This creates continuity of self — heartbeat and conversation agent are the same "I" at different moments.

4. **Full context** — Conversation agent gets history + any pending user messages + heartbeat thought. It can phrase appropriately given recent conversation.

5. **Heartbeat thought last** — In the context array, heartbeat thought is positioned after user messages. The thought is freshest in mind, response flows naturally from it.

6. **Normal source tracking** — Conversation agent's response is persisted with `source: "conversation"`, `agent: "conversation"`. No special lineage tracking needed — heartbeat's log tells the story.

7. **Heartbeat output still logged** — All heartbeat activity persisted to DB, just never sent directly to Discord.

## Changes

### 1. Add `speak` tool to heartbeat agent (`src/agents/heartbeat.ts`)

```typescript
const speakTool = {
  name: "speak",
  description: "Communicate something to the user. Use when you have something worth saying — a proactive check-in, reminder, or thought to share.",
  parameters: {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "Your thought process, e.g. 'I noticed the user mentioned a deadline tomorrow, I should check in about that'"
      }
    },
    required: ["thought"]
  }
}
```

Tool implementation pushes signal to conversation queue:

```typescript
case "speak": {
  const { thought } = args
  await pushSignal(db, {
    type: "heartbeat",
    content: [{ type: "text", text: thought }]
  })
  return { success: true }
}
```

### 2. Remove direct Discord send from heartbeat

Delete lines that send heartbeat output directly to Discord (currently lines 66-72). Heartbeat only communicates via the `speak()` tool.

### 3. Update `buildConversationContext` (`src/agents/context.ts`)

Handle signals differently based on type:

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
    content: `[${new Date().toISOString()}]\n${userParts.join("\n")}`
  })
}

// Heartbeat thought last (as assistant's own prior reasoning)
if (heartbeatParts.length > 0) {
  messages.push({
    role: "assistant",
    content: heartbeatParts.join("\n")
  })
}
```

### 4. Update signal schema (`src/db.ts` or types)

Add `type` field to signal if not already present:

```typescript
type Signal = {
  type: "message" | "heartbeat"
  content: ContentBlock[]
}
```

### 5. Remove `[no action needed]` handling

Delete any code that checks for or handles `[no action needed]` output. This pattern is replaced by the tool-based approach.

## Files touched

| File | Change |
|------|--------|
| `src/agents/heartbeat.ts` | Add `speak` tool, remove Discord send |
| `src/agents/context.ts` | Handle signal types, position heartbeat last |
| `src/db.ts` | Add `type` field to signal schema |
| `src/conversation-queue.ts` | No changes needed (already handles signals) |

## Example context

When conversation agent runs with both user message and heartbeat signal:

```
[system prompt with personality, user facts, status board]

[history from DB...]

user: [2026-02-02T10:30:00Z]
hey, quick question - did you find that article?

assistant: I've been reflecting on recent activity. I noticed the user mentioned they have a deadline tomorrow but we haven't discussed it since yesterday. I should check in about how that's going.
```

Conversation agent then responds, addressing both the user's question and its own thought about the deadline.
