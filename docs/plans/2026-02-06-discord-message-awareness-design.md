# Discord Message Awareness

## Problem

When a user sends a non-text message through Discord (e.g. voice message, file attachment), the assistant has zero awareness it happened. Non-image attachments are silently dropped in `discord.ts` before anything reaches the agent. If the message has no text, it's discarded entirely — no error, no acknowledgment.

## Solution

Serialize the Discord message payload into `Signal.metadata.discord` and inject an ephemeral system message into the agent's context. The agent gains full awareness of what arrived (attachments, message type, flags, etc.) without polluting the persisted conversation history.

## Design

### 1. Serialize Discord envelope (`discord.ts`)

In the `messageCreate` handler, serialize the Discord `Message` object into a plain JSON structure and attach it to `Signal.metadata.discord`:

```ts
metadata: {
  userId: message.author.id,
  username: message.author.username,
  discord: {
    type: message.type,
    flags: message.flags.toArray(),
    createdAt: message.createdTimestamp,
    editedAt: message.editedTimestamp,
    pinned: message.pinned,
    tts: message.tts,
    author: { id: message.author.id, username: message.author.username },
    content: message.content || null,
    attachments: [...message.attachments.values()].map(a => ({
      name: a.name,
      contentType: a.contentType,
      size: a.size,
      duration: a.duration,
      waveform: a.waveform,
      width: a.width,
      height: a.height,
      description: a.description,
    })),
    embeds: message.embeds.map(e => e.toJSON()),
    stickers: [...message.stickers.values()].map(s => ({ name: s.name, format: s.format })),
    reference: message.reference,
    poll: message.poll ? { question: message.poll.question.text } : null,
  },
},
```

The `content` array (text + images) continues to be built as before — that's the actual message payload. The metadata is the raw envelope.

### 2. Inject ephemeral system message (`context.ts`)

In `buildConversationContext`, after pushing the user message and before the heartbeat/time messages, collect all Discord envelopes and inject a single ephemeral system message:

```ts
const discordEnvelopes = signals
  .filter(s => s.metadata?.discord)
  .map(s => s.metadata!.discord)

if (discordEnvelopes.length > 0) {
  messages.push({
    role: "system",
    content: `The user sent ${discordEnvelopes.length} message(s) via Discord.\n\n` +
      `Raw message envelopes:\n${JSON.stringify(discordEnvelopes, null, 2)}`
  })
}
```

### Why ephemeral?

The system message is naturally ephemeral — it's part of the `messages` array built by `buildConversationContext`, which is consumed by the orchestrator and discarded. Persistence happens separately:

- Inbound signals are persisted via `signalToPersisted`, which only reads `Signal.content` (text + images), not metadata
- Assistant responses are persisted from the orchestrator's output nodes

The Discord envelope never touches the database. No context rot.

### Multiple queued messages

The queue may contain multiple signals if the user sends several messages before the agent starts. Each signal gets its own envelope, and all envelopes are collected into a single system message. This ensures the agent sees the full picture even when messages batch up.

## Files changed

- `src/discord.ts` — serialize Discord message into `Signal.metadata.discord`
- `src/agents/conversation/context.ts` — inject ephemeral system message from Discord envelopes
