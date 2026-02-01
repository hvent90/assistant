import type { AgentStatus, StatusBoard } from "./types"

export function createStatusBoard() {
  const state: StatusBoard = {
    conversation: { status: "idle", detail: null },
    heartbeat: { status: "idle", detail: null },
  }

  return {
    get(): StatusBoard {
      return {
        conversation: { ...state.conversation },
        heartbeat: { ...state.heartbeat },
      }
    },
    update(agent: keyof StatusBoard, status: AgentStatus) {
      state[agent] = status
    },
    format(): string {
      const lines: string[] = []
      for (const [name, s] of Object.entries(state)) {
        const detail = s.detail ? ` — ${s.detail}` : ""
        lines.push(`${name}: ${s.status}${detail}`)
      }
      return lines.join("\n")
    },
  }
}
