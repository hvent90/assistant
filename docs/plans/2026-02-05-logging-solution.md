# Comprehensive Logging Solution

## Problem

The assistant process runs as a long-lived daemon, but we have no reliable way to diagnose issues when things go wrong:

1. **Lost errors**: When the conversation agent hangs or fails silently, we have no record of what happened
2. **Limited scrollback**: Console output goes to tmux with finite history - older logs are lost
3. **No structured data**: Plain text logs are hard to search and correlate
4. **Missing context**: When an error occurs, we don't capture the surrounding state (signals received, agent status, etc.)

### Recent incident

User sent a message asking the assistant to respond in 2 minutes. The assistant showed "thinking" in Discord but never responded. Investigation found:
- Message was persisted to DB (received successfully)
- No response was persisted (agent never completed)
- No error in tmux scrollback
- Agent likely hung in `collectAgentOutput` waiting for events that never came

We have no way to know if:
- The LLM call failed
- The orchestrator threw an error
- There was a timeout
- The process crashed and restarted

## Requirements

- Persist logs to disk (survive tmux scrollback limits)
- Structured logging (JSON) for searchability
- Log levels (debug, info, warn, error)
- Context propagation (request IDs, signal IDs, agent names)
- Error capturing with stack traces
- Rotation/retention policy

## Open Questions

1. **Library choice**: pino? winston? bunyan? simple file append?
2. **Log destination**: Local files? Also ship to a service?
3. **What to log**:
   - All agent lifecycle events?
   - LLM requests/responses (large, potentially sensitive)?
   - Tool executions?
   - Discord events?
4. **Retention**: How long to keep logs? Auto-rotate?
5. **Performance**: Async writes? Buffering?

## Ideas

### Minimum viable logging

Just get errors to disk with context:

```typescript
// src/logger.ts
import { appendFileSync } from "fs"

export function log(level: string, message: string, context?: Record<string, unknown>) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...context,
  })
  appendFileSync("logs/assistant.log", entry + "\n")
  if (level === "error") console.error(message, context)
}
```

### Pino-based solution

More robust, async, with pretty-printing for dev:

```typescript
import pino from "pino"

export const logger = pino({
  transport: {
    targets: [
      { target: "pino-pretty", level: "debug" }, // console
      { target: "pino/file", options: { destination: "logs/assistant.log" }, level: "info" },
    ],
  },
})
```

### Request-scoped logging

Pass a logger instance through the call chain with bound context:

```typescript
const runLogger = logger.child({
  runId: crypto.randomUUID(),
  signals: signals.map(s => s.id),
})

runLogger.info("starting conversation run")
// ... later ...
runLogger.error({ err }, "agent failed")
```

## Next Steps

1. Decide on library/approach
2. Implement basic file logging for errors
3. Add logging to conversation agent lifecycle
4. Add logging to llm-gateway orchestrator events
5. Consider adding timeouts to prevent silent hangs
