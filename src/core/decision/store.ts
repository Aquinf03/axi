/** Persist decision loop state under ~/.axi/chats/<id>/decision.json */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { axiHome } from "../home.js"
import {
  DECISION_FILE,
  DECISION_SCHEMA,
  emptyLoop,
  type DecisionLoopState,
  type LoopOnError,
} from "./types.js"

export function decisionPath(sessionId: string): string {
  return path.join(axiHome(), "chats", sessionId, DECISION_FILE)
}

function sanitizeActions(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && k.trim() && typeof v === "string" && v.trim()) {
      out[k.trim()] = v.trim().slice(0, 500)
    }
  }
  return out
}

export function sanitizeLoop(raw: Partial<DecisionLoopState> | null | undefined): DecisionLoopState {
  const base = emptyLoop()
  if (!raw || typeof raw !== "object") return base
  const status = raw.status
  const okStatus =
    status === "idle" ||
    status === "running" ||
    status === "paused" ||
    status === "stopped" ||
    status === "error"
  const onError: LoopOnError = raw.onError === "skip" ? "skip" : "stop"
  return {
    schema: DECISION_SCHEMA,
    status: okStatus ? status : "idle",
    objective: typeof raw.objective === "string" ? raw.objective.slice(0, 2000) : "",
    goal: typeof raw.goal === "string" ? raw.goal.slice(0, 2000) : "",
    actions: sanitizeActions(raw.actions),
    observeCmd: typeof raw.observeCmd === "string" ? raw.observeCmd.slice(0, 4000) : "",
    actCmd: typeof raw.actCmd === "string" ? raw.actCmd.slice(0, 4000) : "",
    workspace: typeof raw.workspace === "string" ? raw.workspace : "",
    instructions:
      typeof raw.instructions === "string" && raw.instructions.trim()
        ? raw.instructions.trim().slice(0, 2000)
        : base.instructions,
    tickMs: Math.max(0, Math.floor(Number(raw.tickMs) || 0)),
    maxSteps: Math.max(1, Math.floor(Number(raw.maxSteps) || 100)),
    historySize: Math.max(1, Math.min(100, Math.floor(Number(raw.historySize) || 20))),
    decideTimeoutMs: Math.max(1000, Math.floor(Number(raw.decideTimeoutMs) || 30_000)),
    onError,
    step: Math.max(0, Math.floor(Number(raw.step) || 0)),
    history: Array.isArray(raw.history) ? raw.history.slice(-200) : [],
    goalUpdates: Array.isArray(raw.goalUpdates) ? raw.goalUpdates.slice(-50) : [],
    errors: Array.isArray(raw.errors) ? raw.errors.slice(-50) : [],
    lastError: typeof raw.lastError === "string" ? raw.lastError : undefined,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
  }
}

export function loadDecisionLoop(sessionId: string): DecisionLoopState {
  if (!sessionId) return emptyLoop()
  const p = decisionPath(sessionId)
  if (!existsSync(p)) return emptyLoop()
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<DecisionLoopState>
    return sanitizeLoop(raw)
  } catch {
    return emptyLoop()
  }
}

export function saveDecisionLoop(sessionId: string, state: DecisionLoopState): void {
  if (!sessionId) return
  const p = decisionPath(sessionId)
  mkdirSync(path.dirname(p), { recursive: true })
  const next = { ...state, schema: DECISION_SCHEMA, updatedAt: new Date().toISOString() }
  writeFileSync(p, JSON.stringify(next, null, 2) + "\n", "utf8")
}

export function updateDecisionLoop(
  sessionId: string,
  fn: (cur: DecisionLoopState) => DecisionLoopState,
): DecisionLoopState {
  const next = fn(loadDecisionLoop(sessionId))
  saveDecisionLoop(sessionId, next)
  return next
}
