import { getPendingDueTasks, updateTaskStatus, setKv, type ScheduledTask } from "../db"

const POLL_INTERVAL_MS = 60_000
const LAST_POLL_KEY = "scheduler_last_poll_at"

export async function pollOnce(
  onTask: (task: ScheduledTask) => Promise<number>,
): Promise<void> {
  const tasks = await getPendingDueTasks(new Date())

  await Promise.all(
    tasks.map(async (task) => {
      await updateTaskStatus(task.id, "running")
      try {
        const sessionId = await onTask(task)
        await updateTaskStatus(task.id, "completed", undefined, sessionId)
      } catch (err: any) {
        await updateTaskStatus(task.id, "failed", err.message ?? String(err))
      }
    }),
  )
}

type SchedulerOpts = {
  onTask: (task: ScheduledTask) => Promise<number>
}

export async function startScheduler(opts: SchedulerOpts) {
  const { onTask } = opts

  async function poll() {
    try {
      await pollOnce(onTask)
      await setKv(LAST_POLL_KEY, { timestamp: Date.now() })
    } catch (err) {
      console.error("scheduler poll error:", err)
    }
  }

  // Fire immediately to catch up on missed tasks, then poll on interval
  poll()
  const timerId = setInterval(poll, POLL_INTERVAL_MS)

  return {
    poll,
    stop() {
      clearInterval(timerId)
    },
  }
}
