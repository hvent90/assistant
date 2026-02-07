import type { ViewNode, ViewContent } from "llm-gateway/packages/ai/client"

export function renderViewContent(content: ViewContent): string {
  switch (content.kind) {
    case "text":
      return content.text
    case "reasoning":
      return `> *${content.text.split("\n").join("\n> ")}*`
    case "tool_call":
      return `\`${content.name}\``
    case "error":
      return `**Error:** ${content.message}`
    case "pending":
      return "*thinking...*"
    case "user":
    case "relay":
      return ""
  }
}

export function renderViewNodes(nodes: ViewNode[]): string {
  const parts: string[] = []
  for (const node of nodes) {
    if (node.role === "user") continue
    const text = renderViewContent(node.content)
    if (text) parts.push(text)
    // Render branches (subagent responses nested under tool calls)
    for (const branch of node.branches) {
      const branchText = renderViewNodes(branch)
      if (branchText) parts.push(branchText)
    }
  }
  return parts.join("\n")
}

export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]

  const lines = text.split("\n")
  const chunks: string[] = []
  let current = ""
  let inCodeBlock = false

  for (const line of lines) {
    const lineWithNewline = current ? "\n" + line : line

    if (line.startsWith("```")) inCodeBlock = !inCodeBlock

    // If adding this line would exceed the limit and we're not inside a code block,
    // flush the current chunk and start a new one
    if (current.length + lineWithNewline.length > maxLen && current && !inCodeBlock) {
      chunks.push(current)
      current = line
    } else {
      current += lineWithNewline
    }
  }

  if (current) chunks.push(current)

  // Fallback: if any chunk is still over the limit, hard-split it
  const result: string[] = []
  for (const chunk of chunks) {
    if (chunk.length <= maxLen) {
      result.push(chunk)
    } else {
      let remaining = chunk
      while (remaining.length > 0) {
        result.push(remaining.slice(0, maxLen))
        remaining = remaining.slice(maxLen)
      }
    }
  }

  return result
}
