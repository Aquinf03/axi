/**
 * Drive shell quality gates.
 * Pass → stop Drive keep-going (does NOT complete the mission objective).
 * Fail → continue with failure output until gateRetries exhausted.
 */

import { spawnSync } from "node:child_process"
import { updateMission } from "./store.js"
import type { DriveFacet, DriveGateConfig, MissionState } from "./types.js"
import { MISSION_DRIVE_PREFIX } from "./types.js"

const GATE_TIMEOUT_MS = 120_000
const GATE_OUT_CAP = 4_000

export type GateRunResult = {
  ok: boolean
  command: string
  output: string
  status: number | null
}

/** Run one shell gate in `workspace`. Exit 0 = pass. */
export function runShellGate(workspace: string, command: string): GateRunResult {
  const cmd = command.trim()
  if (!cmd) return { ok: false, command: cmd, output: "empty gate command", status: null }
  const r = spawnSync("sh", ["-c", cmd], {
    cwd: workspace,
    encoding: "utf8",
    timeout: GATE_TIMEOUT_MS,
    env: { ...process.env, AQ_QUIET: "1" },
  })
  let out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim()
  if (r.error) out = (out ? out + "\n" : "") + String(r.error.message ?? r.error)
  if (out.length > GATE_OUT_CAP) out = out.slice(0, GATE_OUT_CAP) + "\n…"
  const status = typeof r.status === "number" ? r.status : null
  return { ok: status === 0, command: cmd, output: out || (status === 0 ? "ok" : `exit ${status}`), status }
}

/** Run all gate commands; first failure wins. Empty gates → null (no gate). */
export function runDriveGates(
  workspace: string,
  gates: DriveGateConfig,
): GateRunResult | null {
  if (!gates.commands.length) return null
  for (const command of gates.commands) {
    const r = runShellGate(workspace, command)
    if (!r.ok) return r
  }
  const last = gates.commands[gates.commands.length - 1]!
  return { ok: true, command: last, output: "all gates passed", status: 0 }
}

export type GateDecision =
  | { kind: "none" }
  | { kind: "pass"; result: GateRunResult; notice: string }
  | { kind: "fail_continue"; result: GateRunResult; message: string; notice: string }
  | { kind: "fail_stop"; result: GateRunResult; notice: string }

/**
 * Evaluate gates for an enabled Drive. Updates failure counters on the mission.
 * Gate pass ≠ objective complete.
 */
export function evaluateDriveGates(
  sessionId: string,
  state: MissionState,
  workspace: string | undefined,
): GateDecision {
  const d = state.drive
  if (!d?.enabled || !d.gates?.commands.length) return { kind: "none" }
  if (!workspace) {
    return {
      kind: "fail_continue",
      result: {
        ok: false,
        command: d.gates.commands[0]!,
        output: "no workspace for gate",
        status: null,
      },
      message: gateFailMessage(d, d.gates.commands[0]!, "no workspace for gate", d.gates.failures + 1),
      notice: "mission drive  gate skipped (no workspace)",
    }
  }

  const result = runDriveGates(workspace, d.gates)
  if (!result) return { kind: "none" }

  if (result.ok) {
    recordGateOutcome(sessionId, { ok: true, result, failures: 0 })
    return {
      kind: "pass",
      result,
      notice:
        `mission drive  gate passed — Drive stopped (objective unchanged)\n` +
        `  ${result.command}`,
    }
  }

  const failures = d.gates.failures + 1
  const max = d.limits.gateRetries
  recordGateOutcome(sessionId, { ok: false, result, failures })

  if (max > 0 && failures >= max) {
    return {
      kind: "fail_stop",
      result,
      notice:
        `mission drive  gate failed ${failures}/${max} — Drive stopped\n` +
        `  ${result.command}`,
    }
  }

  return {
    kind: "fail_continue",
    result,
    message: gateFailMessage(d, result.command, result.output, failures),
    notice: `mission drive  gate failed ${failures}${max > 0 ? `/${max}` : ""} — continuing`,
  }
}

function gateFailMessage(
  d: DriveFacet,
  command: string,
  output: string,
  failures: number,
): string {
  const max = d.limits.gateRetries
  return [
    MISSION_DRIVE_PREFIX,
    "",
    "Shell quality gate failed. Fix the failure and continue.",
    "Gate pass stops Drive only — it does NOT complete the mission objective.",
    "",
    `<gate command="${command}" failures="${failures}${max > 0 ? `/${max}` : ""}">`,
    output.slice(0, GATE_OUT_CAP),
    "</gate>",
    "",
    `continuations ${d.continuationsUsed + 1}/${d.limits.maxContinuations} · turns ${d.turnsUsed}/${d.limits.maxTurns}`,
  ].join("\n")
}

function recordGateOutcome(
  sessionId: string,
  opts: { ok: boolean; result: GateRunResult; failures: number },
): void {
  updateMission(sessionId, (cur) => {
    const drive = cur.drive
    if (!drive?.gates) return cur
    return {
      ...cur,
      drive: {
        ...drive,
        gates: {
          ...drive.gates,
          failures: opts.failures,
          lastOk: opts.ok,
          lastCommand: opts.result.command,
          lastOutput: opts.result.output.slice(0, GATE_OUT_CAP),
        },
      },
    }
  })
}
