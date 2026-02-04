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
