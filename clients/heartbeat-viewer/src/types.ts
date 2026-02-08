import type { Node } from "llm-gateway/packages/ai/client"

export type Agent = "heartbeat" | "conversation" | "scheduled"

export interface Session {
  id: number
  createdAt: string
  preview: string
}

export interface TriggeredBy {
  id: number
  prompt: string
  fireAt: string
}

export interface SessionDetail {
  id: number
  createdAt: string
  nodes: Node[]
  triggeredBy?: TriggeredBy | null
}

export interface ScheduledTask {
  id: number
  fireAt: string
  prompt: string
  status: string
  attempts: number
  maxAttempts: number
  lastError: string | null
  sessionId: number | null
  createdAt: string
}
