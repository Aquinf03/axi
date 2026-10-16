/** CLI: axi mission tick|status — durable pulse without a daemon. */

import { rebuildPulseIndex, listDuePulseJobs, loadPulseIndex } from "../mission/pulse-store.js"
import { markDuePulses, missionStatusText } from "../mission.js"

function help(): string {
  return [
    "axi mission",
    "",
    "  axi mission tick [--json]   mark due pulses (run from cron/launchd when chat is closed)",
    "  axi mission status [id]     show mission for a chat session id",
    "  axi mission rebuild-index   rescan chats into ~/.axi/pulse-jobs.json",
    "",
    "Pulse schedules live in each chat's mission.json; the index is for tick.",
  ].join("\n")
}

export async function missionCmd(argv: string[]): Promise<void> {
  const sub = (argv[0] ?? "help").toLowerCase()
  if (sub === "help" || sub === "-h" || sub === "--help") {
    console.log(help())
    return
  }

  if (sub === "rebuild-index") {
    const index = rebuildPulseIndex()
    const n = Object.keys(index.jobs).length
    console.log(`pulse index  ${n} job${n === 1 ? "" : "s"}  (~/.axi/pulse-jobs.json)`)
    return
  }

  if (sub === "status") {
    const id = argv[1]
    if (!id) {
      const index = loadPulseIndex()
      const rows = Object.values(index.jobs)
      if (!rows.length) {
        console.log("no pulse jobs in index — set /mission pulse in a chat, or axi mission rebuild-index")
        return
      }
      for (const j of rows.sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))) {
        console.log(`${j.sessionId}  ${j.status}  ${j.schedule}  next ${j.nextRunAt}`)
      }
      return
    }
    console.log(missionStatusText(id))
    return
  }

  if (sub === "tick") {
    const json = argv.includes("--json")
    const before = listDuePulseJobs()
    const marked = markDuePulses()
    if (json) {
      console.log(JSON.stringify({ due: before.length, marked }, null, 2))
      return
    }
    if (!marked.length) {
      console.log(`mission tick  0 due`)
      return
    }
    console.log(`mission tick  marked ${marked.length} due`)
    for (const m of marked) {
      console.log(`  ${m.sessionId}  ${m.schedule}`)
    }
    console.log("(open the chat to deliver, or leave it open with an armed pulse timer)")
    return
  }

  console.error(help())
  process.exitCode = 1
}
