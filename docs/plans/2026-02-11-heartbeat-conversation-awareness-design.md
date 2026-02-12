# Heartbeat Conversation Awareness

## Problem

The heartbeat agent reads memory files and generates follow-ups without knowing what the conversation agent just discussed. This causes duplicate questions (e.g., asking about cash withdrawal minutes after the conversation agent already handled it).

## Solution

Inject the last 20 messages (text-only, no tool calls or reasoning) into the heartbeat context at build time. The heartbeat LLM sees recent conversation and can reason about what's already handled.

## Changes

### 1. `src/db/client.ts` — Add `getRecentMessages`

```ts
export async function getRecentMessages(limit: number): Promise<Array<{
  role: string
  text: string
  created_at: Date
}>> {
  const result = await getPool().query(
    `SELECT
       role,
       jsonb_path_query_array(content, '$[*] ? (@.kind == "text" || @.kind == "user").content') AS texts,
       created_at
     FROM messages
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  )
  return result.rows
    .reverse()
    .map(r => ({
      role: r.role,
      text: (r.texts as string[]).join("\n"),
      created_at: r.created_at,
    }))
    .filter(r => r.text.length > 0)
}
```

### 2. `src/agents/heartbeat/context.ts` — Accept and render recent history

- Add `recentHistory` to `HeartbeatContextInput`
- Format as timestamped transcript in a `## Recent Conversation` block
- Remove step 5 (manual DB query instruction)

### 3. `src/agents/heartbeat/run.ts` — Fetch and pass history

- Call `getRecentMessages(20)` before building context
- Pass result into `buildHeartbeatContext`
