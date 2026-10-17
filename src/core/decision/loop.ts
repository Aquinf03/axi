/**
 * Host Decision Loop: observe (shell) → decide → act (shell).
 * System 2 updates goal via setDecisionGoal; does not pick actions.
 */

import { spawnSync } from "node:child_process"
import { decide } from "./decide.js"
import { loadDecisionLoop, saveDecisionLoop, updateDecisionLoop } from "./store.js"
import {
  emptyLoop,
  type DecideOpts,
  type DecisionAnswer,
  type DecisionLoopState,
} from "./types.js"

const SHELL_OUT_CAP = 8_000
const SHELL_TIMEOUT_MS = 120_000

type SessionRuntime = {
  timer?: ReturnType<typeof setTimeout>
  busy?: boolean
  onTick?: (sessionId: string, notice: string) => void
  /** Inject decide for tests. */
  decideFn?: (opts: DecideOpts) => Promise<DecisionAnswer>
}

const runtimes = new Map<string, SessionRuntime>()

function rt(sessionId: string): SessionRuntime {
  let s = runtimes.get(sessionId)
  if (!s) {
    s = {}
    runtimes.set(sessionId, s)
  }
  return s
}

function nowIso(): string {
  return new Date().toISOString()
}

function runShell(
  workspace: string,
  command: string,
  envExtra?: Record<string, string>,
): { ok: boolean; output: string; status: number | null } {
  const cmd = command.trim()
  if (!cmd) return { ok: false, output: "empty command", status: null }
  const r = spawnSync("sh", ["-c", cmd], {
    cwd: workspace || process.cwd(),
    encoding: "utf8",
    timeout: SHELL_TIMEOUT_MS,
    env: { ...process.env, ...envExtra },
  })
  let out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim()
  if (r.error) out = (out ? out + "\n" : "") + String(r.error.message ?? r.error)
  if (out.length > SHELL_OUT_CAP) out = out.slice(0, SHELL_OUT_CAP) + "\n…"
  const status = typeof r.status === "number" ? r.status : null
  return { ok: status === 0, output: out, status }
}

export type StartLoopOpts = {
  sessionId: string
  workspace: string
  objective: string
  actions: Record<string, string>
  observeCmd: string
  actCmd: string
  goal?: string
  instructions?: string
  tickMs?: number
  maxSteps?: number
  historySize?: number
  decideTimeoutMs?: number
  onError?: "stop" | "skip"
  /** Run first tick immediately (default true). */
  kick?: boolean
}

export function onDecisionLoopTick(
  sessionId: string,
  cb: (sessionId: string, notice: string) => void,
): void {
  rt(sessionId).onTick = cb
}

export function clearDecisionLoopTimer(sessionId: string): void {
  const s = runtimes.get(sessionId)
  if (s?.timer) clearTimeout(s.timer)
  if (s) s.timer = undefined
}

export function clearAllDecisionLoops(): void {
  for (const id of [...runtimes.keys()]) {
    clearDecisionLoopTimer(id)
    runtimes.delete(id)
  }
}

export function setDecisionDecideFn(
  sessionId: string,
  fn: ((opts: DecideOpts) => Promise<DecisionAnswer>) | undefined,
): void {
  rt(sessionId).decideFn = fn
}

function scheduleNext(sessionId: string, delayMs: number): void {
  const s = rt(sessionId)
  if (s.timer) clearTimeout(s.timer)
  s.timer = setTimeout(() => {
    s.timer = undefined
    void runDecisionTick(sessionId)
  }, Math.max(0, delayMs))
}

export function startDecisionLoop(opts: StartLoopOpts): DecisionLoopState {
  const sid = opts.sessionId
  if (!sid) throw new Error("decision loop needs a session")
  if (!opts.observeCmd.trim()) throw new Error("decision loop needs observeCmd")
  if (!opts.actCmd.trim()) throw new Error("decision loop needs actCmd")
  if (!Object.keys(opts.actions).length) throw new Error("decision loop needs actions")

  clearDecisionLoopTimer(sid)
  const t = nowIso()
  const objective = opts.objective.trim().slice(0, 2000)
  const state: DecisionLoopState = {
    ...emptyLoop(),
    status: "running",
    objective,
    goal: (opts.goal ?? objective).trim().slice(0, 2000),
    actions: { ...opts.actions },
    observeCmd: opts.observeCmd.trim(),
    actCmd: opts.actCmd.trim(),
    workspace: opts.workspace || process.cwd(),
    instructions: opts.instructions?.trim() || emptyLoop().instructions,
    tickMs: Math.max(0, Math.floor(opts.tickMs ?? 0)),
    maxSteps: Math.max(1, Math.floor(opts.maxSteps ?? 100)),
    historySize: Math.max(1, Math.min(100, Math.floor(opts.historySize ?? 20))),
    decideTimeoutMs: Math.max(1000, Math.floor(opts.decideTimeoutMs ?? 30_000)),
    onError: opts.onError === "skip" ? "skip" : "stop",
    step: 0,
    history: [],
    goalUpdates: [],
    errors: [],
    createdAt: t,
    updatedAt: t,
  }
  saveDecisionLoop(sid, state)
  if (opts.kick !== false) scheduleNext(sid, 0)
  return state
}

export function pauseDecisionLoop(sessionId: string): DecisionLoopState {
  clearDecisionLoopTimer(sessionId)
  return updateDecisionLoop(sessionId, (cur) => {
    if (cur.status !== "running") return cur
    return { ...cur, status: "paused", updatedAt: nowIso() }
  })
}

export function resumeDecisionLoop(sessionId: string): DecisionLoopState {
  const next = updateDecisionLoop(sessionId, (cur) => {
    if (cur.status !== "paused") return cur
    return { ...cur, status: "running", updatedAt: nowIso() }
  })
  if (next.status === "running") scheduleNext(sessionId, 0)
  return next
}

export function stopDecisionLoop(sessionId: string): DecisionLoopState {
  clearDecisionLoopTimer(sessionId)
  return updateDecisionLoop(sessionId, (cur) => ({
    ...cur,
    status: "stopped",
    updatedAt: nowIso(),
  }))
}

export function setDecisionGoal(sessionId: string, goal: string): DecisionLoopState {
  const g = goal.trim()
  if (!g) throw new Error("goal must be non-empty")
  return updateDecisionLoop(sessionId, (cur) => ({
    ...cur,
    goal: g.slice(0, 2000),
    goalUpdates: [...cur.goalUpdates, { step: cur.step, goal: g.slice(0, 2000), at: nowIso() }].slice(
      -50,
    ),
    updatedAt: nowIso(),
  }))
}

export function formatDecisionLoopStatus(state?: DecisionLoopState): string {
  const s = state ?? emptyLoop()
  if (!s.objective && s.status === "idle") return "decision loop  (none)"
  const last = s.history[s.history.length - 1]
  const lines = [
    `decision loop  ${s.status}  ·  step ${s.step}/${s.maxSteps}`,
    `  objective  ${s.objective.slice(0, 120)}`,
    `  goal  ${s.goal.slice(0, 120)}`,
    `  observe  ${s.observeCmd.slice(0, 80)}`,
    `  act  ${s.actCmd.slice(0, 80)}`,
    `  tick  ${s.tickMs}ms  ·  on_error  ${s.onError}  ·  errors  ${s.errors.length}`,
  ]
  if (last) {
    lines.push(
      `  last  ${last.action}  conf ${last.confidence ?? "—"}  ·  ${last.latency_ms ?? "—"}ms`,
    )
  }
  if (s.lastError) lines.push(`  error  ${s.lastError}`)
  return lines.join("\n")
}

/**
 * One loop tick. Safe to call from timer or tests.
 * @returns notice string for the host UI, or null if skipped.
 */
export async function runDecisionTick(sessionId: string): Promise<string | null> {
  const s = rt(sessionId)
  if (s.busy) return null
  let state = loadDecisionLoop(sessionId)
  if (state.status !== "running") return null
  if (state.step >= state.maxSteps) {
    stopDecisionLoop(sessionId)
    const notice = `decision loop  stopped — max steps ${state.maxSteps}`
    s.onTick?.(sessionId, notice)
    return notice
  }

  s.busy = true
  const tickStarted = Date.now()
  try {
    const obs = runShell(state.workspace, state.observeCmd)
    if (!obs.ok) {
      return await handleTickError(sessionId, "observe", obs.output || `exit ${obs.status}`)
    }
    const observation = obs.output
    if (!observation.trim()) {
      stopDecisionLoop(sessionId)
      const notice = "decision loop  stopped — observe returned empty (end)"
      s.onTick?.(sessionId, notice)
      return notice
    }

    state = loadDecisionLoop(sessionId)
    const hist = state.history.slice(-state.historySize).map((h) => ({
      action: h.action,
      confidence: h.confidence,
    }))
    const decideFn = s.decideFn ?? decide
    let answer: DecisionAnswer
    try {
      answer = await decideFn({
        observation,
        actions: state.actions,
        goal: state.goal,
        instructions: state.instructions,
        history: hist,
        timeoutMs: state.decideTimeoutMs,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return await handleTickError(sessionId, "decide", msg)
    }

    const actCmd = state.actCmd.replaceAll("{action}", answer.action)
    const act = runShell(state.workspace, actCmd, { AXI_DECISION_ACTION: answer.action })
    if (!act.ok) {
      return await handleTickError(sessionId, "act", act.output || `exit ${act.status}`)
    }

    state = updateDecisionLoop(sessionId, (cur) => {
      const row = {
        step: cur.step,
        action: answer.action,
        confidence: answer.confidence,
        latency_ms: answer.latency_ms,
        observationPreview: observation.slice(0, 200),
      }
      return {
        ...cur,
        step: cur.step + 1,
        history: [...cur.history, row].slice(-200),
        updatedAt: nowIso(),
      }
    })

    const notice = `decision loop  step ${state.step}  →  ${answer.action}  conf ${answer.confidence}`
    s.onTick?.(sessionId, notice)

    state = loadDecisionLoop(sessionId)
    if (state.status === "running") {
      const elapsed = Date.now() - tickStarted
      const delay = Math.max(0, state.tickMs - elapsed)
      scheduleNext(sessionId, delay)
    }
    return notice
  } finally {
    s.busy = false
  }
}

async function handleTickError(
  sessionId: string,
  where: string,
  error: string,
): Promise<string | null> {
  const s = rt(sessionId)
  const state = updateDecisionLoop(sessionId, (cur) => ({
    ...cur,
    errors: [...cur.errors, { step: cur.step, where, error: error.slice(0, 500) }].slice(-50),
    lastError: `${where}: ${error.slice(0, 200)}`,
    updatedAt: nowIso(),
  }))
  if (state.onError === "skip") {
    updateDecisionLoop(sessionId, (cur) => ({
      ...cur,
      step: cur.step + 1,
      updatedAt: nowIso(),
    }))
    const notice = `decision loop  skip error @${where}  ·  ${error.slice(0, 80)}`
    s.onTick?.(sessionId, notice)
    const next = loadDecisionLoop(sessionId)
    if (next.status === "running") scheduleNext(sessionId, next.tickMs)
    return notice
  }
  stopDecisionLoop(sessionId)
  const notice = `decision loop  stopped — ${where}: ${error.slice(0, 120)}`
  s.onTick?.(sessionId, notice)
  return notice
}

/** Arm timer after chat open if a loop was left running. */
export function armDecisionLoop(sessionId: string): void {
  const state = loadDecisionLoop(sessionId)
  if (state.status === "running") scheduleNext(sessionId, 0)
}
