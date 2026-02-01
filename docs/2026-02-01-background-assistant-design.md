# Background Assistant Design

## Overview

A background AI assistant that runs autonomously, responds to user messages across multiple channels (Discord, CLI, web, SMS), performs proactive work via a heartbeat, and persists state across ephemeral agent runs. Built on top of llm-gateway's existing agent harness.

## Core Insight

An agent is ephemeral — it is the sum of its context window in any given moment. The real infrastructure problem is **context window management**: how to assemble the right context for a given moment, and how to persist what matters back out. There is no "sleeping agent." There is a state store and a context assembly pipeline that gets invoked per trigger.

## Primitives

The system is built on a small set of composable primitives:

1. **Signals** — typed events that trigger agent runs
2. **Queues** — per-agent signal accumulation with drain semantics
3. **Context pipeline** — configurable stages that assemble a context window
4. **Agent loop** — llm-gateway's existing harness (think, act, observe, correct)
5. **Tools** — bash as the catch-all primitive; the agent uses raw tools (file I/O, DB queries) rather than purpose-built abstractions
6. **Channels** — pluggable mediums for user interaction (Discord, CLI, web, SMS)
7. **Persistent state** — Postgres + files on disk

## Signals

Every trigger is a **signal** — a typed event with a payload:

```typescript
type Signal = {
  type: "message" | "heartbeat" | string    // extensible
  source: string                             // "discord", "cli", "cron", etc.
  content: ContentBlock[] | null             // multimodal content
  channelId?: string
  metadata?: Record<string, unknown>
  timestamp: number
}
```

A user message on Discord and a heartbeat tick are both signals. They differ in type and payload, but flow through the same machinery. Adding a new trigger source means defining a signal shape and adding a source that emits it.

## Two Agents, One Identity

The system runs two agents concurrently, sharing the same identity, personality, memories, and tools:

### Conversation Agent

- **Triggered by**: user message signals draining from queue
- **Purpose**: direct user interaction — responds to messages
- **Queue semantics**: messages accumulate while the agent is running; when it finishes, the entire queue drains into the next run as a single user turn
- **Context**: drained messages + recent conversation history + agent status board + ambient context

### Heartbeat Agent

- **Triggered by**: periodic timer signal (e.g., every 30 minutes)
- **Purpose**: proactive reflection and autonomous work
- **Gate semantics**: if already running, skip the tick
- **Context**: recent conversation history + agent status board + ambient context + "reflect on what needs doing"

Both agents run through the same context pipeline and agent harness. They see each other via the agent status board.

## Queue & Backpressure

User messages are a **backpressure problem**. The agent provides tremendous backpressure (it's slow relative to human typing), so messages accumulate in a queue. When the agent is ready, it drains the entire queue — all accumulated messages become a single user turn.

```
User sends messages → Queue accumulates
                           ↓
Agent finishes (or is idle) → Drain all → Single user turn
                           ↓
Agent runs → new messages accumulate → repeat
```

No debounce timers or heuristics. The agent's processing time IS the batching window.

## Context Pipeline

An ordered list of stages that assemble a context window from persisted state and the triggering signal:

```
Stages:
  1. System prompt (personality, instructions, tool documentation)
  2. Signal-specific context (conversation history for messages, recent summary for heartbeat)
  3. Agent status board (what other agents are currently doing)
  4. Ambient context (active tasks, relevant memories — evolves over time)
  5. Trigger payload (the drained messages, or heartbeat signal)
```

Each stage is a function: `(currentContext, signal) -> enrichedContext`. Stages can be added, removed, or reordered. This pipeline will be a major source of future iteration — summarization, relevance filtering, priority juggling, potentially even LLM calls as stages in the reducer. The shape just needs to be right: a composable list of functions.

## Agent Status Board

A shared structure so agents can see each other:

```typescript
{
  "conversation": { "status": "idle", "detail": null },
  "heartbeat": { "status": "running", "detail": "writing a dinner recipe" }
}
```

Each agent updates its own entry on start/finish. The status board is included in every agent's context. This enables natural cross-awareness — the conversation agent can say "by the way, I'm working on a recipe right now" because it can see the heartbeat agent's status.

## Channels

Each channel is a medium for user interaction. A channel can:

- **Listen**: emit signals into the queue (inbound)
- **Deliver**: route agent output to the user (outbound)

The agent does not use a tool to send messages. The agent's output stream (text events from the harness) is routed to the originating channel by the infrastructure. The agent just talks; the system delivers.

Channels planned:
- **Discord** (first) — bot via WebSocket, supports text + multimodal
- **CLI** — direct terminal interaction
- **Web app** — custom web interface
- **SMS** — future, when cost-effective

Conversations are cross-channel by default. If the user starts on Discord and switches to CLI, the agent has the full history from both. Same identity, same memory, same thread.

## Channel Implementation: Discord

**Inbound**: Discord.js bot holds a persistent WebSocket connection. Messages arrive, get wrapped as signals, pushed to the conversation queue.

**Outbound**: Infrastructure subscribes to the conversation agent's output stream and delivers content to the originating Discord channel.

**Multimodal**: Attachments (images, files, voice) are downloaded and stored on the file system. The signal's content blocks reference the local file paths.

## Persistence & Storage

| Data | Storage | Access |
|------|---------|--------|
| Conversation history | Postgres | Context pipeline reads; agent queries via tools |
| Agent status board | Postgres or in-memory | Read/write by infrastructure |
| Memories / notes | Markdown files on disk | Agent reads/writes via bash |
| Structured knowledge | Postgres | Agent queries directly |
| Binary assets (images, files) | File system | Referenced by file path in messages |
| Vector embeddings | Vector store (future) | Semantic search — added when needed |

Messages in the DB use multimodal content blocks with file references for binary content:

```typescript
{
  role: "user" | "assistant",
  content: [
    { type: "text", text: "check out this error" },
    { type: "image", path: "/data/assets/abc123.png" },
    { type: "file", path: "/data/assets/logs.txt", filename: "logs.txt" }
  ],
  source: "discord",
  channelId: "...",
  timestamp: ...
}
```

No purpose-built memory abstraction. The agent uses bash to read files, runs SQL to query the database. Instructions in the system prompt tell it where things are and what conventions to follow.

## Mapping to llm-gateway

Existing llm-gateway components used as-is:

| Component | File | Role |
|-----------|------|------|
| Agent harness | `packages/ai/harness/agent.ts` | Think/act/observe loop with tool execution |
| Orchestrator | `packages/ai/orchestrator.ts` | Spawns and manages agent lifecycle |
| Multiplexer | `packages/ai/multiplexer.ts` | Runs conversation + heartbeat agents concurrently |
| Bash tool | `packages/ai/tools/bash.ts` | Catch-all primitive for the agent |
| Provider harnesses | `packages/ai/harness/providers/` | LLM API integrations |

New components to build:

| Component | Purpose |
|-----------|---------|
| Signal router | Receives signals, routes to the right agent queue |
| Conversation queue | Message accumulation with drain-all semantics |
| Heartbeat emitter | Timer that emits heartbeat signals on interval |
| Context pipeline | Assembles context window per agent run |
| Agent status board | Shared state for cross-agent awareness |
| Discord channel | Bot (inbound) + output routing (outbound) |
| Persistence layer | Postgres schema + file storage conventions |
| Process wrapper | pm2-managed long-running process hosting everything |

## Architecture Diagram

```
┌──────────────────────────────────────────────────────┐
│  pm2-managed process                                 │
│                                                      │
│  ┌─────────────┐  ┌───────────┐                     │
│  │ Discord Bot  │  │ Heartbeat │  ...future sources  │
│  │ (WebSocket)  │  │ (Timer)   │                     │
│  └──────┬───────┘  └─────┬─────┘                     │
│         │                │                            │
│      signal           signal                          │
│         │                │                            │
│         ▼                ▼                            │
│  ┌──────────────────────────────┐                    │
│  │        Signal Router         │                    │
│  └──────┬───────────────┬───────┘                    │
│         ▼               ▼                            │
│  ┌────────────┐  ┌──────────────┐                   │
│  │Convo Queue │  │Heartbeat Gate│                   │
│  │  (drain)   │  │(skip if busy)│                   │
│  └─────┬──────┘  └──────┬───────┘                   │
│        ▼                ▼                            │
│  ┌───────────────────────────────┐                   │
│  │       Context Pipeline        │                   │
│  │  [system, history, status,    │                   │
│  │   ambient, trigger payload]   │                   │
│  └───────────────┬───────────────┘                   │
│                  ▼                                    │
│  ┌───────────────────────────────┐                   │
│  │  llm-gateway Agent Harness    │                   │
│  │  (think → act → observe)      │                   │
│  │  Tools: bash                  │                   │
│  └───────────┬───────────────────┘                   │
│              │                                        │
│       output stream                                   │
│              │                                        │
│              ▼                                        │
│  ┌───────────────────────────────┐                   │
│  │     Channel Output Router     │                   │
│  │  (routes to originating       │                   │
│  │   channel: Discord, CLI, etc) │                   │
│  └───────────────────────────────┘                   │
│                                                      │
│  ┌───────────────────────────────┐                   │
│  │       Shared State            │                   │
│  │  ├── Postgres (history,       │                   │
│  │  │   structured data,         │                   │
│  │  │   status board)            │                   │
│  │  └── Files (memories,         │                   │
│  │      assets, markdown)        │                   │
│  └───────────────────────────────┘                   │
└──────────────────────────────────────────────────────┘
```

## Open Questions (Deferred)

- Context pipeline stage ordering and what ambient context to include — will emerge through usage
- Heartbeat interval tuning — start with something reasonable, adjust
- Vector store selection and when to introduce it
- How memories are organized on disk (directory conventions)
- Postgres schema details — design when implementing
- Whether/how the agent manages long-running tasks across multiple heartbeat runs
- SMS channel cost and integration approach
