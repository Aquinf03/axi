/** CLI: axi daemon start|stop|status|run */

import {
  formatDaemonStatusText,
  runDaemonServer,
  startDaemonDetached,
  stopDaemon,
} from "../daemon.js"

function help(): string {
  return [
    "axi daemon",
    "",
    "  axi daemon start    detach background supervisor",
    "  axi daemon stop     shut down",
    "  axi daemon status   up/down + paths",
    "  axi daemon run      foreground (launchd / debug)",
    "",
    "When up: ticks mission pulses + factory runs; agent spawn prefers the daemon.",
  ].join("\n")
}

export async function daemonCmd(argv: string[]): Promise<void> {
  const sub = (argv[0] ?? "status").toLowerCase()
  if (sub === "help" || sub === "-h" || sub === "--help") {
    console.log(help())
    return
  }
  if (sub === "status") {
    console.log(formatDaemonStatusText())
    return
  }
  if (sub === "stop") {
    console.log(stopDaemon())
    return
  }
  if (sub === "start") {
    const { pid, sock } = startDaemonDetached()
    console.log(`axi daemon  started  pid ${pid}`)
    console.log(`  socket  ${sock}`)
    return
  }
  if (sub === "run") {
    process.env.AXI_DAEMON_FOREGROUND = "1"
    console.error("axi daemon  running (foreground)  ctrl+c to stop")
    await runDaemonServer()
    return
  }
  console.error(help())
  process.exitCode = 1
}
