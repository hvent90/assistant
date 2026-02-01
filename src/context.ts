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
