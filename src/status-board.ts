import { setKv } from "./db"
import type { AgentStatus, StatusBoard, StatusBoardInstance } from "./types"

const STATUS_BOARD_KEY = "status_board"

export async function createStatusBoard(): Promise<StatusBoardInstance> {
  const state: StatusBoard = {
    conversation: { status: "idle", detail: null },
    heartbeat: { status: "idle", detail: null },
  }

  await setKv(STATUS_BOARD_KEY, state)

  return {
    get(): StatusBoard {
      return {
        conversation: { ...state.conversation },
        heartbeat: { ...state.heartbeat },
      }
    },
    async update(agent: keyof StatusBoard, status: AgentStatus) {
      state[agent] = status
      await setKv(STATUS_BOARD_KEY, state)
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
