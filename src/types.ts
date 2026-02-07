import type { ContentPart } from "llm-gateway/packages/ai/types"

export type Signal = {
  type: "message" | "heartbeat"
  source: string
  content: ContentPart[] | null
  channelId?: string
  metadata?: Record<string, unknown>
  timestamp: number
}

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
}
