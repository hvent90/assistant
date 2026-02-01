export type Signal = {
  type: "message" | "heartbeat"
  source: string
  content: ContentBlock[] | null
  channelId?: string
  metadata?: Record<string, unknown>
  timestamp: number
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; path: string; mimeType: string }
  | { type: "file"; path: string; filename: string }

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
  format(): string
}
